import './config/ethereal.js';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import {
  closeQueue,
  startEmailWorker,
  type EmailWorkerRuntime,
} from './queue/index.js';

function assertProductionConfig(): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (!env.FRONTEND_URL.startsWith('https://')) {
    problems.push('FRONTEND_URL must use https');
  }
  if (!env.GOOGLE_CALLBACK_URL.startsWith('https://')) {
    problems.push('GOOGLE_CALLBACK_URL must use https');
  }
  if (!env.GOOGLE_CLIENT_ID) problems.push('GOOGLE_CLIENT_ID is required');
  if (!env.GOOGLE_CLIENT_SECRET) problems.push('GOOGLE_CLIENT_SECRET is required');

  if (problems.length > 0) {
    logger.error({ problems }, 'invalid production configuration');
    process.exit(1);
  }
}

assertProductionConfig();

let workerRuntime: EmailWorkerRuntime | null = null;

const workerStartup: Promise<void> = env.EMBED_WORKER
  ? startEmailWorker()
      .then((runtime) => {
        workerRuntime = runtime;
        logger.info({ mode: 'embedded' }, 'delivery worker attached to API');
      })
      .catch((error) => {
        logger.error({ err: error }, 'embedded delivery worker failed to start');
      })
  : Promise.resolve();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, embedWorker: env.EMBED_WORKER },
    'API listening',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down API');
  server.close(async () => {
    try {
      await workerStartup;
      await workerRuntime?.close();
      await closeQueue();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
