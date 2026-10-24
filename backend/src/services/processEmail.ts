import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { reserveSendSlot } from '../ratelimit/hourly.js';
import { sendEmail } from './mailer.js';

export interface SendJobData {
  emailId: string;
}

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
}

export async function processEmail(
  job: Job<SendJobData>,
  token: string,
): Promise<{ skipped?: boolean; sent?: boolean; deferred?: boolean }> {
  const { emailId } = job.data;

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: {
      sender: true,
      batch: { select: { delayMs: true, hourlyLimit: true } },
    },
  });

  if (!email || email.status === 'SENT' || email.status === 'FAILED') {
    return { skipped: true };
  }

  const claimed = await prisma.email.updateMany({
    where: {
      id: emailId,
      OR: [
        { status: 'SCHEDULED' },
        {
          status: 'PROCESSING',
          claimedAt: { lt: new Date(Date.now() - env.CLAIM_TTL_MS) },
        },
      ],
    },
    data: {
      status: 'PROCESSING',
      claimedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    await job.moveToDelayed(Date.now() + 30_000, token);
    throw new DelayedError();
  }

  const reservation = await reserveSendSlot({
    senderId: email.senderId,
    batchId: email.batchId,
    hourlyLimit: email.batch.hourlyLimit,
    minDelayMs: Math.max(env.MIN_DELAY_BETWEEN_EMAILS_MS, email.batch.delayMs),
  });

  if (!reservation.allowed) {
    const jitter = reservation.reason === 'hourly' ? (email.seq % 1000) * 10 : 0;
    const next = Math.max(Date.now() + 50, reservation.retryAt + jitter);

    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'SCHEDULED', scheduledAt: new Date(next), claimedAt: null },
    });
    await job.moveToDelayed(next, token);
    throw new DelayedError();
  }

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
      where: { id: emailId },
      data: {
        status: 'SENT',
        finishedAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        error: null,
      },
    });

    return { sent: true };
  } catch (error) {
    const err = error as SmtpError;
    const permanent = (err.responseCode ?? 0) >= 500 || err.code === 'EENVELOPE';
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    if (permanent || lastAttempt) {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: String(err.message),
        },
      });

      logger.warn({ emailId, permanent, attemptsMade: job.attemptsMade }, 'email failed');
      if (permanent) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }

    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'SCHEDULED', claimedAt: null, error: String(err.message) },
    });

    logger.warn(
      { emailId, attemptsMade: job.attemptsMade, err: err.message },
      'email send failed, retrying with backoff',
    );
    throw err;
  }
}
