import 'dotenv/config';
import { z } from 'zod';

type NodeEnv = 'development' | 'test' | 'production';

function resolveQueueDriver(data: { NODE_ENV: NodeEnv; QUEUE_DRIVER?: 'local' | 'bullmq' }) {
  return data.QUEUE_DRIVER ?? (data.NODE_ENV === 'production' ? 'bullmq' : 'local');
}

function resolveMailTransport(data: {
  NODE_ENV: NodeEnv;
  MAIL_TRANSPORT?: 'local' | 'ethereal';
}) {
  return data.MAIL_TRANSPORT ?? (data.NODE_ENV === 'production' ? 'ethereal' : 'local');
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.string().default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().optional(),
    QUEUE_DRIVER: z.enum(['local', 'bullmq']).optional(),
    MAIL_TRANSPORT: z.enum(['local', 'ethereal']).optional(),
    LOCAL_OUTBOX_DIR: z.string().min(1).default('.mail-outbox'),

    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_CALLBACK_URL: z
      .string()
      .url()
      .default('http://localhost:4000/api/auth/google/callback'),

    DEV_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEV_AUTH_EMAIL: z.string().default('dev@reachinbox.test'),
    DEV_AUTH_NAME: z.string().default('Local Demo'),

    JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),

    EMBED_WORKER: z.enum(['true', 'false']).optional(),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
    MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(0).default(2000),
    MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(100),
    RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
    CLAIM_TTL_MS: z.coerce.number().int().min(1000).default(120_000),
    SENDER_COUNT: z.coerce.number().int().min(1).default(3),
  })
  .superRefine((data, ctx) => {
    if (resolveQueueDriver(data) === 'bullmq' && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when QUEUE_DRIVER is bullmq',
      });
    }

    if (data.NODE_ENV !== 'production') return;

    if (data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be at least 32 characters in production',
      });
    }

    if (/change-me|local-demo/i.test(data.JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must not use a documented placeholder value in production',
      });
    }

    if (data.DEV_AUTH_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_AUTH_ENABLED'],
        message: 'DEV_AUTH_ENABLED must be false in production',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  console.error(`[env] Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  REDIS_URL: parsed.data.REDIS_URL ?? '',
  QUEUE_DRIVER: resolveQueueDriver(parsed.data),
  MAIL_TRANSPORT: resolveMailTransport(parsed.data),
  EMBED_WORKER:
    parsed.data.EMBED_WORKER !== undefined
      ? parsed.data.EMBED_WORKER === 'true'
      : parsed.data.NODE_ENV === 'development',
};
export type Env = typeof env;
