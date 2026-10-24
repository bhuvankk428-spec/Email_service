import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: {
    MAX_EMAILS_PER_HOUR_PER_SENDER: 3,
    RATE_WINDOW_MS: 3_600_000,
    MIN_DELAY_BETWEEN_EMAILS_MS: 0,
  },
}));

const { LocalPacer } = await import('../src/queue/localPacer.js');
const { nextWindowStart, windowStart } = await import('../src/lib/window.js');

const now = 1_700_000_000_000 + 1000;

describe('LocalPacer', () => {
  it('enforces the per-sender hourly cap and resets in the next window', () => {
    const pacer = new LocalPacer();

    for (let index = 0; index < 3; index += 1) {
      expect(
        pacer.reserve({
          senderId: 'sender-1',
          batchId: `batch-${index}`,
          hourlyLimit: 100,
          minDelayMs: 0,
          now,
        }),
      ).toEqual({ allowed: true });
    }

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-x',
        hourlyLimit: 100,
        minDelayMs: 0,
        now,
      }),
    ).toEqual({ allowed: false, reason: 'hourly', retryAt: nextWindowStart(now) });

    expect(pacer.eligibleSenderIds(['sender-1'], now)).toEqual([]);
    expect(pacer.eligibleSenderIds(['sender-1'], nextWindowStart(now))).toEqual([
      'sender-1',
    ]);
  });

  it('enforces the per-batch limit without blocking another batch', () => {
    const pacer = new LocalPacer();

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-a',
        hourlyLimit: 1,
        minDelayMs: 0,
        now,
      }),
    ).toEqual({ allowed: true });

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-a',
        hourlyLimit: 1,
        minDelayMs: 0,
        now,
      }),
    ).toEqual({ allowed: false, reason: 'hourly', retryAt: nextWindowStart(now) });

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-b',
        hourlyLimit: 1,
        minDelayMs: 0,
        now,
      }),
    ).toEqual({ allowed: true });
  });

  it('defers until the per-sender minimum gap has elapsed', () => {
    const pacer = new LocalPacer();
    const request = {
      senderId: 'sender-1',
      batchId: 'batch-a',
      hourlyLimit: 100,
      minDelayMs: 5000,
    };

    expect(pacer.reserve({ ...request, now })).toEqual({ allowed: true });
    expect(pacer.reserve({ ...request, now: now + 1000 })).toEqual({
      allowed: false,
      reason: 'delay',
      retryAt: now + 5000,
    });
    expect(pacer.reserve({ ...request, now: now + 5000 })).toEqual({ allowed: true });
  });

  it('hydrates counts and the last send time from persisted history', () => {
    const pacer = new LocalPacer();
    const currentWindow = windowStart(now);

    pacer.hydrate(
      [
        {
          senderId: 'sender-1',
          batchId: 'batch-a',
          finishedAt: new Date(currentWindow + 500),
        },
        {
          senderId: 'sender-1',
          batchId: 'batch-a',
          finishedAt: new Date(currentWindow + 600),
        },
        {
          senderId: 'sender-1',
          batchId: 'batch-a',
          finishedAt: new Date(currentWindow - 500),
        },
      ],
      currentWindow + 1000,
    );

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-b',
        hourlyLimit: 100,
        minDelayMs: 10_000,
        now: currentWindow + 2000,
      }),
    ).toEqual({ allowed: false, reason: 'delay', retryAt: currentWindow + 600 + 10_000 });

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-a',
        hourlyLimit: 100,
        minDelayMs: 0,
        now: currentWindow + 2000,
      }),
    ).toEqual({ allowed: true });

    expect(
      pacer.reserve({
        senderId: 'sender-1',
        batchId: 'batch-b',
        hourlyLimit: 100,
        minDelayMs: 0,
        now: currentWindow + 2000,
      }),
    ).toEqual({ allowed: false, reason: 'hourly', retryAt: nextWindowStart(now) });
  });
});
