import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { baseJobOpts } from './jobOpts.js';
import { LocalPacer } from './localPacer.js';
import { closeMailer, sendEmail } from '../services/mailer.js';

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
}

interface DueEmail {
  id: string;
  batchId: string;
  senderId: string;
  toEmail: string;
  subject: string;
  body: string;
  seq: number;
  attempts: number;
  sender: {
    id: string;
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  batch: {
    delayMs: number;
    hourlyLimit: number;
  };
}

const idlePollMs = 400;
const dueScanSize = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDueEmail(email: DueEmail, pacer: LocalPacer): Promise<boolean> {
  const reservation = pacer.reserve({
    senderId: email.senderId,
    batchId: email.batchId,
    hourlyLimit: email.batch.hourlyLimit,
    minDelayMs: Math.max(env.MIN_DELAY_BETWEEN_EMAILS_MS, email.batch.delayMs),
  });

  if (!reservation.allowed) {
    if (reservation.reason === 'hourly') {
      const jitter = (email.seq % 1000) * 10;
      await prisma.email.updateMany({
        where: { id: email.id, status: 'SCHEDULED' },
        data: {
          scheduledAt: new Date(
            Math.max(Date.now() + 50, reservation.retryAt + jitter),
          ),
        },
      });
      return true;
    }
    return false;
  }

  const claimed = await prisma.email.updateMany({
    where: { id: email.id, status: 'SCHEDULED' },
    data: { status: 'PROCESSING', claimedAt: new Date() },
  });

  if (claimed.count === 0) return false;

  const attempt = email.attempts + 1;

  try {
    const result = await sendEmail(
      email.sender,
      {
        from: email.sender.user,
        to: email.toEmail,
        subject: email.subject,
        html: email.body,
        messageId: `<${email.id}@reachinbox.local>`,
      },
      email.id,
    );

    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'SENT',
        attempts: attempt,
        claimedAt: null,
        finishedAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        error: null,
      },
    });

    logger.info({ emailId: email.id, attempt }, 'local email sent');
    return true;
  } catch (error) {
    const err = error as SmtpError;
    const message = error instanceof Error ? error.message : String(error);
    const permanent = (err.responseCode ?? 0) >= 500 || err.code === 'EENVELOPE';
    const lastAttempt = attempt >= baseJobOpts.attempts;

    if (permanent || lastAttempt) {
      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: 'FAILED',
          attempts: attempt,
          claimedAt: null,
          finishedAt: new Date(),
          error: message,
        },
      });
      logger.warn({ emailId: email.id, attempt, permanent }, 'local email failed');
      return true;
    }

    const backoff = baseJobOpts.backoff.delay * 2 ** (attempt - 1);
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'SCHEDULED',
        attempts: attempt,
        claimedAt: null,
        scheduledAt: new Date(Date.now() + backoff),
        error: message,
      },
    });
    logger.warn(
      { emailId: email.id, attempt, err: message },
      'local email failed, retrying with backoff',
    );
    return true;
  }
}

async function tick(pacer: LocalPacer): Promise<number> {
  const now = Date.now();
  const senders = await prisma.sender.findMany({ select: { id: true } });
  if (senders.length === 0) return 0;

  const eligible = pacer.eligibleSenderIds(senders.map((sender) => sender.id), now);
  if (eligible.length === 0) return 0;

  const due = await prisma.email.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: new Date(now) },
      senderId: { in: eligible },
    },
    include: {
      sender: true,
      batch: { select: { delayMs: true, hourlyLimit: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { seq: 'asc' }],
    take: dueScanSize,
  });

  let progress = 0;
  for (const email of due) {
    if (await processDueEmail(email, pacer)) progress += 1;
  }
  return progress;
}

export interface LocalWorkerRuntime {
  close: () => Promise<void>;
}

export async function startLocalWorker(): Promise<LocalWorkerRuntime> {
  const released = await prisma.email.updateMany({
    where: { status: 'PROCESSING' },
    data: { status: 'SCHEDULED', claimedAt: null },
  });

  if (released.count > 0) {
    logger.info({ released: released.count }, 'released interrupted local deliveries');
  }

  const pacer = new LocalPacer();
  const history = await prisma.email.findMany({
    where: {
      status: 'SENT',
      finishedAt: { gte: new Date(Date.now() - 86_400_000) },
    },
    select: { senderId: true, batchId: true, finishedAt: true },
  });

  pacer.hydrate(
    history
      .filter((row): row is typeof row & { finishedAt: Date } => row.finishedAt !== null)
      .map((row) => ({
        senderId: row.senderId,
        batchId: row.batchId,
        finishedAt: row.finishedAt,
      })),
  );

  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      let progress = 0;
      try {
        progress = await tick(pacer);
      } catch (error) {
        logger.error({ err: error }, 'local worker tick failed');
      }
      if (stopped) break;
      await sleep(progress > 0 ? 10 : idlePollMs);
    }
  };

  const loopPromise = loop();

  logger.info(
    {
      minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      hourlyCap: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      outbox: env.LOCAL_OUTBOX_DIR,
      pacing: 'in-process database poller',
    },
    'local worker started',
  );

  return {
    close: async () => {
      stopped = true;
      await loopPromise;
      await closeMailer();
    },
  };
}
