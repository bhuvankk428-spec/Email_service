import { env } from '../config/env.js';

export const WINDOW_MS = env.RATE_WINDOW_MS;

export const windowId = (ts: number): number => Math.floor(ts / WINDOW_MS);

export const windowStart = (ts: number): number => windowId(ts) * WINDOW_MS;

export const nextWindowStart = (ts: number): number => (windowId(ts) + 1) * WINDOW_MS;
