import './config/ethereal.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeQueue, startEmailWorker } from './queue/index.js';

async function main(): Promise<void> {
  const runtime = await startEmailWorker();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down worker');

    try {
      await runtime.close();
      await closeQueue();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info({ env: env.NODE_ENV }, 'standalone worker running');
}

main().catch((error) => {
  logger.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
