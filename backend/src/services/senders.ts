import { env } from '../config/env.js';
import { LOCAL_MAIL_HOST } from '../lib/mailMode.js';
import { prisma } from '../lib/prisma.js';

export interface SchedulableSender {
  id: string;
}

const inflight = new Map<string, Promise<void>>();

async function provision(userId: string): Promise<void> {
  const localMode = env.MAIL_TRANSPORT === 'local';
  const existing = await prisma.sender.count({
    where: localMode ? { userId, host: LOCAL_MAIL_HOST } : { userId },
  });
  if (existing >= env.SENDER_COUNT) return;

  if (localMode) {
    for (let index = existing; index < env.SENDER_COUNT; index += 1) {
      const user = `sender-${index + 1}-${userId}@${LOCAL_MAIL_HOST}`;
      await prisma.sender.upsert({
        where: { user },
        update: { host: LOCAL_MAIL_HOST, port: 0, pass: '', userId },
        create: {
          host: LOCAL_MAIL_HOST,
          port: 0,
          user,
          pass: '',
          userId,
        },
      });
    }
    return;
  }

  const nodemailer = (await import('nodemailer')).default;

  for (let index = existing; index < env.SENDER_COUNT; index += 1) {
    const account = await nodemailer.createTestAccount();

    await prisma.sender.upsert({
      where: { user: account.user },
      update: {
        host: account.smtp.host,
        port: account.smtp.port,
        pass: account.pass,
        userId,
      },
      create: {
        host: account.smtp.host,
        port: account.smtp.port,
        user: account.user,
        pass: account.pass,
        userId,
      },
    });
  }
}

export function ensureSendersForUser(userId: string): Promise<void> {
  const active = inflight.get(userId);
  if (active) return active;

  const task = provision(userId).finally(() => inflight.delete(userId));
  inflight.set(userId, task);
  return task;
}

export async function loadSchedulableSenders(userId: string): Promise<SchedulableSender[]> {
  const localMode = env.MAIL_TRANSPORT === 'local';
  const owned = await prisma.sender.findMany({
    where: localMode ? { userId, host: LOCAL_MAIL_HOST } : { userId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (owned.length > 0) return owned;
  if (localMode) return [];

  return prisma.sender.findMany({
    where: { userId: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
}
