import { env } from '../config/env.js';
import { nextWindowStart, windowId } from '../lib/window.js';

export interface SendSlotRequest {
  senderId: string;
  batchId: string;
  hourlyLimit: number;
  minDelayMs: number;
  now?: number;
}

export type SendSlotReservation =
  | { allowed: true }
  | { allowed: false; reason: 'delay' | 'hourly'; retryAt: number };

export interface PacerHistoryEntry {
  senderId: string;
  batchId: string;
  finishedAt: Date;
}

export class LocalPacer {
  private readonly lastSentAt = new Map<string, number>();
  private readonly senderWindows = new Map<string, number>();
  private readonly batchWindows = new Map<string, number>();
  private prunedWindow = -1;

  reserve({
    senderId,
    batchId,
    hourlyLimit,
    minDelayMs,
    now = Date.now(),
  }: SendSlotRequest): SendSlotReservation {
    const delay = Math.max(0, minDelayMs);
    const last = this.lastSentAt.get(senderId);

    if (delay > 0 && last !== undefined && now - last < delay) {
      return { allowed: false, reason: 'delay', retryAt: last + delay };
    }

    const window = windowId(now);
    const senderKey = `${senderId}:${window}`;
    const batchKey = `${batchId}:${senderId}:${window}`;
    const senderCount = this.senderWindows.get(senderKey) ?? 0;
    const batchCount = this.batchWindows.get(batchKey) ?? 0;
    const batchLimit = Math.min(
      Math.max(1, hourlyLimit),
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );

    if (
      senderCount >= env.MAX_EMAILS_PER_HOUR_PER_SENDER ||
      batchCount >= batchLimit
    ) {
      return { allowed: false, reason: 'hourly', retryAt: nextWindowStart(now) };
    }

    this.senderWindows.set(senderKey, senderCount + 1);
    this.batchWindows.set(batchKey, batchCount + 1);
    this.lastSentAt.set(senderId, now);
    this.prune(window);

    return { allowed: true };
  }

  eligibleSenderIds(senderIds: string[], now = Date.now()): string[] {
    const window = windowId(now);
    return senderIds.filter(
      (senderId) =>
        (this.senderWindows.get(`${senderId}:${window}`) ?? 0) <
        env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );
  }

  hydrate(entries: PacerHistoryEntry[], now = Date.now()): void {
    const window = windowId(now);

    for (const entry of entries) {
      const finishedAt = entry.finishedAt.getTime();
      if (!Number.isFinite(finishedAt)) continue;

      const previous = this.lastSentAt.get(entry.senderId) ?? 0;
      if (finishedAt > previous) this.lastSentAt.set(entry.senderId, finishedAt);

      if (windowId(finishedAt) !== window) continue;

      const senderKey = `${entry.senderId}:${window}`;
      const batchKey = `${entry.batchId}:${entry.senderId}:${window}`;
      this.senderWindows.set(senderKey, (this.senderWindows.get(senderKey) ?? 0) + 1);
      this.batchWindows.set(batchKey, (this.batchWindows.get(batchKey) ?? 0) + 1);
    }

    this.prune(window);
  }

  private prune(window: number): void {
    if (this.prunedWindow === window) return;

    const suffix = `:${window}`;
    for (const key of this.senderWindows.keys()) {
      if (!key.endsWith(suffix)) this.senderWindows.delete(key);
    }
    for (const key of this.batchWindows.keys()) {
      if (!key.endsWith(suffix)) this.batchWindows.delete(key);
    }
    this.prunedWindow = window;
  }
}
