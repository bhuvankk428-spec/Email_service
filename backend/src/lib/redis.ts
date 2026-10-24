import Redis from 'ioredis';
import { env } from '../config/env.js';

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const connection =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = connection;
}

export function createBlockingConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
