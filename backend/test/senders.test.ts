import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';

const { prismaMock, createTestAccountMock } = vi.hoisted(() => ({
  prismaMock: {
    sender: {
      count: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
  createTestAccountMock: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/config/env.js', () => ({ env: { SENDER_COUNT: 2 } }));
vi.mock('nodemailer', () => ({
  default: { createTestAccount: createTestAccountMock },
}));

const { ensureSendersForUser, loadSchedulableSenders } = await import(
  '../src/services/senders.js'
);

const account = {
  user: 'new@ethereal.email',
  pass: 'secret',
  smtp: { host: 'smtp.ethereal.email', port: 587 },
};

beforeEach(() => {
  vi.clearAllMocks();
  env.MAIL_TRANSPORT = 'ethereal';
});

describe('ensureSendersForUser', () => {
  it('creates only the missing senders and assigns them to the user', async () => {
    prismaMock.sender.count.mockResolvedValue(1);
    createTestAccountMock.mockResolvedValue(account);
    prismaMock.sender.upsert.mockResolvedValue({});

    await ensureSendersForUser('user-1');

    expect(createTestAccountMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: account.user },
        create: expect.objectContaining({ userId: 'user-1' }),
        update: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('does nothing when the user already has the target number', async () => {
    prismaMock.sender.count.mockResolvedValue(2);

    await ensureSendersForUser('user-1');

    expect(createTestAccountMock).not.toHaveBeenCalled();
    expect(prismaMock.sender.upsert).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent provisioning for the same user', async () => {
    prismaMock.sender.count.mockResolvedValue(0);
    createTestAccountMock.mockResolvedValue(account);
    prismaMock.sender.upsert.mockResolvedValue({});

    await Promise.all([
      ensureSendersForUser('user-2'),
      ensureSendersForUser('user-2'),
    ]);

    expect(prismaMock.sender.count).toHaveBeenCalledTimes(1);
    expect(createTestAccountMock).toHaveBeenCalledTimes(2);
  });

  it('creates local outbox senders without contacting Ethereal', async () => {
    env.MAIL_TRANSPORT = 'local';
    prismaMock.sender.count.mockResolvedValue(0);
    prismaMock.sender.upsert.mockResolvedValue({});

    await ensureSendersForUser('user-1');

    expect(createTestAccountMock).not.toHaveBeenCalled();
    expect(prismaMock.sender.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', host: 'outbox.local' },
    });
    expect(prismaMock.sender.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: 'sender-1-user-1@outbox.local' },
        create: expect.objectContaining({
          host: 'outbox.local',
          userId: 'user-1',
        }),
      }),
    );
  });
});

describe('loadSchedulableSenders', () => {
  it('returns owned senders without consulting the shared fallback', async () => {
    prismaMock.sender.findMany.mockResolvedValueOnce([{ id: 'owned-1' }]);

    await expect(loadSchedulableSenders('user-1')).resolves.toEqual([
      { id: 'owned-1' },
    ]);
    expect(prismaMock.sender.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.sender.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('falls back to legacy shared senders when the user owns none', async () => {
    prismaMock.sender.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'shared-1' }]);

    await expect(loadSchedulableSenders('user-1')).resolves.toEqual([
      { id: 'shared-1' },
    ]);
    expect(prismaMock.sender.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId: null } }),
    );
  });

  it('loads only local senders in local mail mode', async () => {
    env.MAIL_TRANSPORT = 'local';
    prismaMock.sender.findMany.mockResolvedValueOnce([{ id: 'local-1' }]);

    await expect(loadSchedulableSenders('user-1')).resolves.toEqual([
      { id: 'local-1' },
    ]);
    expect(prismaMock.sender.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.sender.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', host: 'outbox.local' },
      }),
    );
  });

  it('does not fall back to shared senders in local mail mode', async () => {
    env.MAIL_TRANSPORT = 'local';
    prismaMock.sender.findMany.mockResolvedValueOnce([]);

    await expect(loadSchedulableSenders('user-1')).resolves.toEqual([]);
    expect(prismaMock.sender.findMany).toHaveBeenCalledTimes(1);
  });
});
