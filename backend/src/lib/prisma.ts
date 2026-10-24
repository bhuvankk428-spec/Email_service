import { PrismaClient } from '@prisma/client';
import { PrismaClient as SqlitePrismaClient } from '../../generated/sqlite-client/index.js';
import { env } from '../config/env.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const log: Array<'warn' | 'error'> =
  env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];

const client =
  globalForPrisma.prisma ??
  (env.DATABASE_URL.startsWith('file:')
    ? new SqlitePrismaClient({ log })
    : new PrismaClient({ log }));

export const prisma = client as PrismaClient;

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
