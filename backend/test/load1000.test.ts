import { describe, expect, it, vi } from 'vitest';
import { WINDOW_MS, windowId } from '../src/lib/window.js';
import {
  chunkItems,
  enqueueInChunks,
  toJob,
  type EmailToEnqueue,
} from '../src/queue/jobPayload.js';
import { planSchedule } from '../src/services/planner.js';

const senders = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
const start = Date.UTC(2026, 0, 1, 9, 0, 0);
const count = 1000;
const delayMs = 2000;
const limit = 200;

describe('1000-email load planning', () => {
  it('plans every recipient without exceeding any sender window', () => {
    const planned = planSchedule({
      count,
      senders,
      startTime: start,
      delayMs,
      limit,
      usage: new Map(),
    });

    expect(planned).toHaveLength(count);
    expect(planned.map((item) => item.seq)).toEqual(
      Array.from({ length: count }, (_, index) => index),
    );

    const perWindow = new Map<string, number>();
    const windowTotals = new Map<number, number>();

    for (const item of planned) {
      const time = item.scheduledAt.getTime();
      expect(time).toBeGreaterThanOrEqual(start);

      const window = windowId(time);
      const senderKey = `${item.senderId}:${window}`;
      perWindow.set(senderKey, (perWindow.get(senderKey) ?? 0) + 1);
      windowTotals.set(window, (windowTotals.get(window) ?? 0) + 1);
    }

    expect(perWindow.size).toBe(6);
    for (const senderCount of perWindow.values()) {
      expect(senderCount).toBeLessThanOrEqual(limit);
    }
    expect([...windowTotals.values()].reduce((sum, value) => sum + value, 0)).toBe(
      count,
    );

    for (const sender of senders) {
      const times = planned
        .filter((item) => item.senderId === sender.id)
        .map((item) => item.scheduledAt.getTime());
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(delayMs);
      }
    }
  });

  it('builds and bulk-enqueues 1000 jobs in two 500-job chunks', async () => {
    const emails: EmailToEnqueue[] = Array.from({ length: count }, (_, index) => ({
      id: `load-email-${index}`,
      scheduledAt: new Date(start + index * delayMs),
    }));

    const jobs = emails.map(toJob);
    expect(new Set(jobs.map((job) => job.opts.jobId)).size).toBe(count);
    expect(jobs[0]!.opts.jobId).toBe('load-email-0');
    expect(jobs[0]!.data.emailId).toBe('load-email-0');

    const batches: Array<Array<(typeof jobs)[number]>> = [];
    const addBulk = vi.fn(async (chunk: Array<(typeof jobs)[number]>) => {
      batches.push(chunk);
      return [];
    });

    const queued = await enqueueInChunks(jobs, addBulk, 500);

    expect(queued).toBe(count);
    expect(addBulk).toHaveBeenCalledTimes(2);
    expect(batches.map((batch) => batch.length)).toEqual([500, 500]);
    expect(batches.flat().map((job) => job.opts.jobId)).toEqual(
      emails.map((email) => email.id),
    );
    expect(chunkItems([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(WINDOW_MS).toBeGreaterThan(0);
  });
});
