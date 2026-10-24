import { describe, expect, it } from 'vitest';
import { planSchedule } from '../src/services/planner.js';
import { WINDOW_MS, windowId } from '../src/lib/window.js';

const senders = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
const start = Date.UTC(2026, 0, 1, 9, 0, 0);

describe('planSchedule', () => {
  it('keeps every sender at or below the limit per window and preserves order', () => {
    const planned = planSchedule({
      count: 1000,
      senders,
      startTime: start,
      delayMs: 2000,
      limit: 100,
      usage: new Map(),
    });

    expect(planned).toHaveLength(1000);
    expect(planned.map((item) => item.seq)).toEqual(
      Array.from({ length: 1000 }, (_, index) => index),
    );

    const perWindow = new Map<string, number>();
    for (const item of planned) {
      const key = `${item.senderId}:${windowId(item.scheduledAt.getTime())}`;
      perWindow.set(key, (perWindow.get(key) ?? 0) + 1);
    }
    for (const count of perWindow.values()) {
      expect(count).toBeLessThanOrEqual(100);
    }

    for (const sender of senders) {
      const times = planned
        .filter((item) => item.senderId === sender.id)
        .map((item) => item.scheduledAt.getTime());
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(2000);
      }
    }
  });

  it('moves to the next window instead of dropping overflow', () => {
    const planned = planSchedule({
      count: 10,
      senders: [{ id: 's1' }],
      startTime: start,
      delayMs: 2000,
      limit: 3,
      usage: new Map(),
    });

    expect(planned).toHaveLength(10);

    const firstWindow = planned.filter(
      (item) => windowId(item.scheduledAt.getTime()) === windowId(start),
    );
    expect(firstWindow).toHaveLength(3);
    expect(planned.every((item) => item.scheduledAt.getTime() >= start)).toBe(true);

    const windows = planned.map((item) => windowId(item.scheduledAt.getTime()));
    expect(windows).toEqual([...windows].sort((a, b) => a - b));
  });

  it('accounts for usage already planned by other batches', () => {
    const usage = new Map<string, number>([
      [`s1:${windowId(start)}`, 3],
      [`s2:${windowId(start)}`, 2],
    ]);

    const planned = planSchedule({
      count: 4,
      senders: [{ id: 's1' }, { id: 's2' }],
      startTime: start,
      delayMs: 1000,
      limit: 3,
      usage,
    });

    const s1First = planned.filter(
      (item) => item.senderId === 's1' && windowId(item.scheduledAt.getTime()) === windowId(start),
    );
    expect(s1First).toHaveLength(0);

    const s2First = planned.filter(
      (item) => item.senderId === 's2' && windowId(item.scheduledAt.getTime()) === windowId(start),
    );
    expect(s2First).toHaveLength(1);
  });

  it('spreads a single email per sender starting at startTime', () => {
    const planned = planSchedule({
      count: 3,
      senders,
      startTime: start,
      delayMs: 2000,
      limit: 100,
      usage: new Map(),
    });

    expect(planned.map((item) => item.senderId)).toEqual(['s1', 's2', 's3']);
    expect(planned.every((item) => item.scheduledAt.getTime() === start)).toBe(true);
    expect(WINDOW_MS).toBeGreaterThan(0);
  });

  it('requires at least one sender', () => {
    expect(() =>
      planSchedule({
        count: 1,
        senders: [],
        startTime: start,
        delayMs: 2000,
        limit: 10,
        usage: new Map(),
      }),
    ).toThrow(/at least one sender/);
  });
});
