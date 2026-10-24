import crypto from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { windowId, windowStart } from '../lib/window.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { planSchedule } from '../services/planner.js';
import { ensureSendersForUser, loadSchedulableSenders } from '../services/senders.js';
import { enqueueEmails } from '../queue/index.js';

const router = Router();

interface ScheduleResponse {
  batchId: string;
  total: number;
  acceptedCount: number;
  rejectedCount: number;
  status: 'scheduled';
  firstSendAt: string;
  lastSendAt: string;
  delayMs: number;
  hourlyLimit: number;
  message: string;
  idempotentReplay?: boolean;
  warning?: string;
}

async function replayBatch(
  userId: string,
  idempotencyKey: string,
): Promise<ScheduleResponse | null> {
  const batch = await prisma.batch.findFirst({
    where: { userId, idempotencyKey },
    select: { id: true, total: true, startTime: true, delayMs: true, hourlyLimit: true },
  });
  if (!batch) return null;

  const [range, remaining] = await Promise.all([
    prisma.email.aggregate({
      where: { batchId: batch.id },
      _min: { scheduledAt: true },
      _max: { scheduledAt: true },
    }),
    prisma.email.count({ where: { batchId: batch.id } }),
  ]);

  const first = (range._min.scheduledAt ?? batch.startTime).toISOString();
  const last = (range._max.scheduledAt ?? batch.startTime).toISOString();

  return {
    batchId: batch.id,
    total: batch.total,
    acceptedCount: remaining,
    rejectedCount: batch.total - remaining,
    status: 'scheduled',
    firstSendAt: first,
    lastSendAt: last,
    delayMs: batch.delayMs,
    hourlyLimit: batch.hourlyLimit,
    message: `Scheduled ${remaining} email(s).`,
    idempotentReplay: true,
  };
}

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  body: z.string().trim().min(1, 'Email body is required').max(500_000),
  recipients: z
    .array(z.string().trim().toLowerCase().email('Invalid recipient email'))
    .min(1, 'At least one recipient is required')
    .max(20_000),
  startTime: z.coerce.date().optional(),
  startAt: z.coerce.date().optional(),
  delayMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
  delayBetweenEmailsMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
  delaySeconds: z.coerce.number().min(0).max(86_400).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  maxEmailsPerHour: z.coerce.number().int().min(1).max(100_000).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const payload = scheduleSchema.parse(req.body);

    const requestedStart = payload.startTime ?? payload.startAt;
    if (!requestedStart || Number.isNaN(requestedStart.getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A valid startTime/startAt is required');
    }

    const now = Date.now();
    const startTime = requestedStart.getTime() <= now ? new Date(now) : requestedStart;

    const recipients = [...new Set(payload.recipients)];
    if (recipients.length > 10_000) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A batch is limited to 10000 recipients');
    }

    const requestedDelay =
      payload.delayMs ??
      payload.delayBetweenEmailsMs ??
      (payload.delaySeconds !== undefined
        ? Math.round(payload.delaySeconds * 1000)
        : undefined) ??
      env.MIN_DELAY_BETWEEN_EMAILS_MS;

    const requestedLimit =
      payload.hourlyLimit ??
      payload.maxEmailsPerHour ??
      env.MAX_EMAILS_PER_HOUR_PER_SENDER;

    const effectiveDelay = Math.max(requestedDelay, env.MIN_DELAY_BETWEEN_EMAILS_MS);
    const effectiveLimit = Math.min(
      Math.max(1, requestedLimit),
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );

    const idempotencyKey = payload.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const replay = await replayBatch(req.user!.id, idempotencyKey);
      if (replay) {
        res.status(202).json(replay);
        return;
      }
    }

    try {
      await ensureSendersForUser(req.user!.id);
    } catch (error) {
      logger.warn(
        { err: error, userId: req.user!.id },
        'sender provisioning failed; continuing with existing senders',
      );
    }

    const senders = await loadSchedulableSenders(req.user!.id);
    if (senders.length === 0) {
      throw new HttpError(
        503,
        'NO_SENDERS',
        'No SMTP senders are available. Sign in again with internet access so the API can create Ethereal senders.',
      );
    }

    const createBatch = () => prisma.$transaction(
      async (tx) => {
        if (!env.DATABASE_URL.startsWith('file:')) {
          await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(42, hashtext(${req.user!.id}))) AS lock`;
        }

        const existing = await tx.email.findMany({
          where: {
            status: { in: ['SCHEDULED', 'PROCESSING', 'SENT'] },
            senderId: { in: senders.map((sender) => sender.id) },
            scheduledAt: { gte: new Date(windowStart(startTime.getTime())) },
          },
          select: { senderId: true, scheduledAt: true },
        });

        const usage = new Map<string, number>();
        for (const row of existing) {
          const key = `${row.senderId}:${windowId(row.scheduledAt.getTime())}`;
          usage.set(key, (usage.get(key) ?? 0) + 1);
        }

        const planned = planSchedule({
          count: recipients.length,
          senders,
          startTime: startTime.getTime(),
          delayMs: effectiveDelay,
          limit: effectiveLimit,
          usage,
        });

        const batch = await tx.batch.create({
          data: {
            userId: req.user!.id,
            subject: payload.subject,
            body: payload.body,
            startTime,
            delayMs: effectiveDelay,
            hourlyLimit: effectiveLimit,
            total: planned.length,
            idempotencyKey: idempotencyKey ?? null,
          },
        });

        const ids = planned.map(() => crypto.randomUUID());

        const rows: Prisma.EmailCreateManyInput[] = planned.map((item, index) => ({
          id: ids[index]!,
          batchId: batch.id,
          userId: req.user!.id,
          senderId: item.senderId,
          toEmail: recipients[index]!,
          subject: payload.subject,
          body: payload.body,
          seq: item.seq,
          scheduledAt: item.scheduledAt,
          status: 'SCHEDULED',
        }));

        for (let index = 0; index < rows.length; index += 1000) {
          await tx.email.createMany({ data: rows.slice(index, index + 1000) });
        }

        return {
          batch,
          emails: planned.map((item, index) => ({
            id: ids[index]!,
            scheduledAt: item.scheduledAt,
          })),
        };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    let result: Awaited<ReturnType<typeof createBatch>>;
    try {
      result = await createBatch();
    } catch (error) {

      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await replayBatch(req.user!.id, idempotencyKey);
        if (replay) {
          res.status(202).json(replay);
          return;
        }
      }
      throw error;
    }

    let enqueueWarning: string | undefined;
    try {
      await enqueueEmails(result.emails);
    } catch (error) {

      enqueueWarning = 'Emails were saved but the queue could not be updated yet.';
      logger.error({ err: error, batchId: result.batch.id }, 'post-commit enqueue failed');
    }

    const { firstTime, lastTime } = result.emails.reduce(
      (acc, email) => {
        const time = email.scheduledAt.getTime();
        return {
          firstTime: Math.min(acc.firstTime, time),
          lastTime: Math.max(acc.lastTime, time),
        };
      },
      {
        firstTime: result.emails[0]!.scheduledAt.getTime(),
        lastTime: result.emails[0]!.scheduledAt.getTime(),
      },
    );
    const first = new Date(firstTime).toISOString();
    const last = new Date(lastTime).toISOString();

    res.status(202).json({
      batchId: result.batch.id,
      total: result.emails.length,
      acceptedCount: result.emails.length,
      rejectedCount: 0,
      status: 'scheduled',
      firstSendAt: first,
      lastSendAt: last,
      delayMs: effectiveDelay,
      hourlyLimit: effectiveLimit,
      message: `Scheduled ${result.emails.length} email(s).`,
      ...(enqueueWarning ? { warning: enqueueWarning } : {}),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
