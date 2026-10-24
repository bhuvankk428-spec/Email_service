import { describe, expect, it } from 'vitest';
import { WINDOW_MS, nextWindowStart, windowId } from '../src/lib/window.js';

describe('window helpers', () => {
  it('uses fixed windows', () => {
    const ts = Date.UTC(2026, 0, 1, 9, 30, 0);
    expect(windowId(ts)).toBe(Math.floor(ts / WINDOW_MS));
    expect(nextWindowStart(ts)).toBe((windowId(ts) + 1) * WINDOW_MS);
  });

  it('nextWindowStart is strictly after the timestamp', () => {
    const ts = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(nextWindowStart(ts)).toBeGreaterThan(ts);
    expect(nextWindowStart(nextWindowStart(ts))).toBeGreaterThan(nextWindowStart(ts));
  });
});
