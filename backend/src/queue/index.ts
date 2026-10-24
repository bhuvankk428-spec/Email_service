import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { EmailToEnqueue } from './jobPayload.js';

export interface EmailWorkerRuntime {
  close: () => Promise<void>;
}

export async function enqueueEmails(emails: EmailToEnqueue[]): Promise<void> {
  if (env.QUEUE_DRIVER === 'local') return;

  const { enqueueEmails: enqueue } = await import('./queue.js');
  await enqueue(emails);
}

export async function removeQueuedJobs(ids: string[]): Promise<void> {
  if (env.QUEUE_DRIVER === 'local' || ids.length === 0) return;

  const { queue } = await import('./queue.js');
  const chunkSize = 100;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const results = await Promise.allSettled(chunk.map((id) => queue.remove(id)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      logger.warn({ failed, queued: chunk.length }, 'some queued jobs were already active');
    }
  }
}

export async function startEmailWorker(): Promise<EmailWorkerRuntime> {
  if (env.QUEUE_DRIVER === 'local') {
    const { startLocalWorker } = await import('./localWorker.js');
    return startLocalWorker();
  }

  const { startEmailWorker: startBullWorker } = await import('./workerRuntime.js');
  return startBullWorker();
}

export async function closeQueue(): Promise<void> {
  if (env.QUEUE_DRIVER === 'local') return;

  const [{ queue }, { connection }] = await Promise.all([
    import('./queue.js'),
    import('../lib/redis.js'),
  ]);

  await queue.close();
  await connection.quit();
}
