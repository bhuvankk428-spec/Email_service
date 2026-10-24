import { Router } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    if (env.QUEUE_DRIVER === 'bullmq') {
      const { connection } = await import('../lib/redis.js');
      await connection.ping();
    }

    res.json({
      status: 'ok',
      service: 'reachinbox-scheduler-api',
      queueDriver: env.QUEUE_DRIVER,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      service: 'reachinbox-scheduler-api',
      queueDriver: env.QUEUE_DRIVER,
      timestamp: new Date().toISOString(),
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'The database or queue backend is unavailable',
      },
    });
  }
});

export default router;
