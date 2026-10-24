import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { nextWindowStart } from '../src/lib/window.js';
import type { SendJobData } from '../src/services/processEmail.js';

const { prismaMock, reserveSendSlotMock, sendEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    email: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  reserveSendSlotMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/ratelimit/hourly.js', () => ({
  reserveSendSlot: reserveSendSlotMock,
}));
vi.mock('../src/services/mailer.js', () => ({
  sendEmail: sendEmailMock,
}));

const { processEmail } = await import('../src/services/processEmail.js');

const sender = {
  id: 's1',
  host: 'smtp.ethereal.email',
  port: 587,
  user: 'sender@ethereal.email',
  pass: 'secret',
};

function buildEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email-1',
    batchId: 'batch-1',
    userId: 'user-1',
    senderId: sender.id,
    toEmail: 'recipient@example.com',
    subject: 'Hello',
    body: '<p>Hello</p>',
    seq: 0,
    scheduledAt: new Date(),
    status: 'SCHEDULED',
    attempts: 0,
    claimedAt: null,
    finishedAt: null,
    messageId: null,
    previewUrl: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sender,
    batch: { delayMs: 2000, hourlyLimit: 100 },
    ...overrides,
  };
}

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    data: { emailId: 'email-1' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Job<SendJobData> & { moveToDelayed: ReturnType<typeof vi.fn> };
}

function smtpError(message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), extra);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.email.findUnique.mockResolvedValue(buildEmail());
  prismaMock.email.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.email.update.mockResolvedValue({});
  reserveSendSlotMock.mockResolvedValue({ allowed: true });
  sendEmailMock.mockResolvedValue({
    messageId: '<email-1@reachinbox.local>',
    previewUrl: null,
  });
});

describe('processEmail', () => {
  it('skips unknown, sent, and failed emails without claiming', async () => {
    prismaMock.email.findUnique.mockResolvedValueOnce(null);
    await expect(processEmail(buildJob(), 'token')).resolves.toEqual({ skipped: true });

    prismaMock.email.findUnique.mockResolvedValueOnce(buildEmail({ status: 'SENT' }));
    await expect(processEmail(buildJob(), 'token')).resolves.toEqual({ skipped: true });

    prismaMock.email.findUnique.mockResolvedValueOnce(buildEmail({ status: 'FAILED' }));
    await expect(processEmail(buildJob(), 'token')).resolves.toEqual({ skipped: true });

    expect(prismaMock.email.updateMany).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('defers when another worker holds a fresh claim', async () => {
    prismaMock.email.updateMany.mockResolvedValue({ count: 0 });
    const job = buildJob();

    const before = Date.now();
    await expect(processEmail(job, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    const [delay] = job.moveToDelayed.mock.calls[0]!;
    expect(delay).toBeGreaterThanOrEqual(before + 30_000);
    expect(reserveSendSlotMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('passes the batch send gap and hourly limit to the atomic reservation', async () => {
    prismaMock.email.findUnique.mockResolvedValue(
      buildEmail({ batch: { delayMs: 5000, hourlyLimit: 7 } }),
    );

    await processEmail(buildJob(), 'token');

    expect(reserveSendSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: sender.id,
        batchId: 'batch-1',
        hourlyLimit: 7,
        minDelayMs: expect.any(Number),
      }),
    );
    expect(reserveSendSlotMock.mock.calls[0]![0].minDelayMs).toBeGreaterThanOrEqual(5000);
  });

  it('moves an hourly-limited email to the next window instead of failing it', async () => {
    reserveSendSlotMock.mockResolvedValue({
      allowed: false,
      reason: 'hourly',
      retryAt: nextWindowStart(Date.now()),
    });
    const job = buildJob();

    await expect(processEmail(job, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(prismaMock.email.update).toHaveBeenCalledTimes(1);
    const update = prismaMock.email.update.mock.calls[0]![0];
    expect(update.data.status).toBe('SCHEDULED');
    expect(update.data.claimedAt).toBeNull();
    expect(update.data.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      nextWindowStart(Date.now()),
    );

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(job.moveToDelayed.mock.calls[0]![0]).toBe(update.data.scheduledAt.getTime());
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('waits out the per-sender delay without advancing the email window', async () => {
    const retryAt = Date.now() + 150;
    reserveSendSlotMock.mockResolvedValue({
      allowed: false,
      reason: 'delay',
      retryAt,
    });
    const job = buildJob();

    await expect(processEmail(job, 'token')).rejects.toBeInstanceOf(DelayedError);

    const update = prismaMock.email.update.mock.calls[0]![0];
    expect(update.data.status).toBe('SCHEDULED');
    expect(update.data.claimedAt).toBeNull();
    expect(update.data.scheduledAt.getTime()).toBeGreaterThanOrEqual(retryAt);
    expect(job.moveToDelayed.mock.calls[0]![0]).toBe(update.data.scheduledAt.getTime());
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends with a deterministic Message-ID and records the result', async () => {
    const result = await processEmail(buildJob(), 'token');

    expect(result).toEqual({ sent: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0]![1]).toMatchObject({
      from: sender.user,
      to: 'recipient@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      messageId: '<email-1@reachinbox.local>',
    });

    const update = prismaMock.email.update.mock.calls[0]![0];
    expect(update.data.status).toBe('SENT');
    expect(update.data.messageId).toBe('<email-1@reachinbox.local>');
    expect(update.data.finishedAt).toBeInstanceOf(Date);
  });

  it('fails immediately on a permanent SMTP error', async () => {
    sendEmailMock.mockRejectedValue(smtpError('mailbox unavailable', { responseCode: 550 }));

    await expect(processEmail(buildJob(), 'token')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(prismaMock.email.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.email.update.mock.calls[0]![0].data.status).toBe('FAILED');
  });

  it('fails on the last attempt of a transient error', async () => {
    sendEmailMock.mockRejectedValue(smtpError('try later', { responseCode: 421 }));
    const job = buildJob({ attemptsMade: 2 });

    await expect(processEmail(job, 'token')).rejects.toThrow('try later');

    expect(prismaMock.email.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.email.update.mock.calls[0]![0].data.status).toBe('FAILED');
  });

  it('resets to SCHEDULED and rethrows when a transient error will be retried', async () => {
    sendEmailMock.mockRejectedValue(smtpError('try later', { responseCode: 421 }));

    await expect(processEmail(buildJob(), 'token')).rejects.toThrow('try later');

    expect(prismaMock.email.update).toHaveBeenCalledTimes(1);
    const data = prismaMock.email.update.mock.calls[0]![0].data;
    expect(data.status).toBe('SCHEDULED');
    expect(data.claimedAt).toBeNull();
    expect(data.error).toBe('try later');
  });
});
