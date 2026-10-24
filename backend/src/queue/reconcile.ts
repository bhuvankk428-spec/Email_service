import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { enqueueEmails } from './index.js';

export async function reconcile(): Promise<{ requeued: number; released: number }> {
  const released = await prisma.email.updateMany({
    where: {
      status: 'PROCESSING',
      claimedAt: { lt: new Date(Date.now() - env.CLAIM_TTL_MS) },
    },
    data: { status: 'SCHEDULED', claimedAt: null },
  });

  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const rows = await prisma.email.findMany({
      where: { status: 'SCHEDULED' },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true, scheduledAt: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (rows.length === 0) break;

    await enqueueEmails(rows);
    cursor = rows[rows.length - 1]!.id;
    total += rows.length;
  }

  logger.info({ requeued: total, released: released.count }, 'reconcile complete');
  return { requeued: total, released: released.count };
}
