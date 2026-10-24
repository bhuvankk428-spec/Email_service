import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createBlockingConnection } from '../lib/redis.js';
import { closeMailer } from '../services/mailer.js';
import { processEmail } from '../services/processEmail.js';
import type { SendJobData } from '../services/processEmail.js';
import { QUEUE_NAME } from './queue.js';
import { reconcile } from './reconcile.js';

export interface EmailWorkerRuntime {
  close: () => Promise<void>;
}

export async function startEmailWorker(): Promise<EmailWorkerRuntime> {
  await reconcile();

  const workerConnection = createBlockingConnection();

  const worker = new Worker<SendJobData>(
    QUEUE_NAME,
    (job, token) => processEmail(job, token!),
    {
      connection: workerConnection,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 60_000,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job, result) => {
    logger.info({ emailId: job.data.emailId, result }, 'job completed');
  });

  worker.on('failed', (job, error) => {
    logger.warn(
      { emailId: job?.data.emailId, err: error.message, attemptsMade: job?.attemptsMade },
      'job failed',
    );
  });

  worker.on('error', (error) => {
    logger.error({ err: error }, 'worker error');
  });

  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      hourlyCap: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      pacing: 'per-sender redis reservation',
    },
    'worker started',
  );

  return {
    close: async () => {
      await worker.close();
      await closeMailer();
      await workerConnection.quit();
    },
  };
}
