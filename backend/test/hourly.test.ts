import { describe, expect, it } from 'vitest';
import { windowId } from '../src/lib/window.js';
import { batchRateLimitKey, rateLimitKey } from '../src/ratelimit/hourly.js';

const ts = Date.UTC(2026, 0, 1, 9, 30);
const window = windowId(ts);

describe('hourly rate-limit keys', () => {
  it('scopes the batch limit per batch, sender, and window', () => {
    expect(batchRateLimitKey('batch-1', 'sender-1', ts)).toBe(
      `rl:batch:batch-1:sender-1:${window}`,
    );
    expect(batchRateLimitKey('batch-1', 'sender-1', ts)).not.toBe(
      batchRateLimitKey('batch-1', 'sender-2', ts),
    );
    expect(batchRateLimitKey('batch-1', 'sender-1', ts)).not.toBe(
      batchRateLimitKey('batch-2', 'sender-1', ts),
    );
    expect(batchRateLimitKey('batch-1', 'sender-1', ts)).not.toBe(
      batchRateLimitKey('batch-1', 'sender-1', ts + 3_600_000),
    );
  });

  it('scopes the server-wide limit per sender and window', () => {
    expect(rateLimitKey('sender-1', ts)).toBe(`rl:sender-1:${window}`);
  });
});
