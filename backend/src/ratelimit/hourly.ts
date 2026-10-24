import { env } from '../config/env.js';
import { connection } from '../lib/redis.js';
import { WINDOW_MS, nextWindowStart, windowId } from '../lib/window.js';

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

type ReservationReply = [number, number];

type RedisWithCommand = typeof connection & {
  reserveSendSlot: (
    batchKey: string,
    senderKey: string,
    lastSendKey: string,
    now: number,
    minDelayMs: number,
    batchLimit: number,
    senderLimit: number,
    ttlMs: number,
  ) => Promise<ReservationReply>;
};

connection.defineCommand('reserveSendSlot', {
  numberOfKeys: 3,
  lua: `
    local now = tonumber(ARGV[1])
    local minDelay = tonumber(ARGV[2])
    local batchLimit = tonumber(ARGV[3])
    local senderLimit = tonumber(ARGV[4])
    local ttl = tonumber(ARGV[5])

    local last = tonumber(redis.call('GET', KEYS[3]) or '0')
    if minDelay > 0 and now - last < minDelay then
      return {0, last + minDelay}
    end

    local batchCount = tonumber(redis.call('GET', KEYS[1]) or '0')
    if batchCount >= batchLimit then return {2, 0} end

    local senderCount = tonumber(redis.call('GET', KEYS[2]) or '0')
    if senderCount >= senderLimit then return {2, 0} end

    local batchNext = redis.call('INCR', KEYS[1])
    if batchNext == 1 then redis.call('PEXPIRE', KEYS[1], ttl) end

    local senderNext = redis.call('INCR', KEYS[2])
    if senderNext == 1 then redis.call('PEXPIRE', KEYS[2], ttl) end

    redis.call('SET', KEYS[3], now, 'PX', ttl)
    return {1, 0}
  `,
});

export function batchRateLimitKey(
  batchId: string,
  senderId: string,
  ts = Date.now(),
): string {
  return `rl:batch:${batchId}:${senderId}:${windowId(ts)}`;
}

export function rateLimitKey(senderId: string, ts = Date.now()): string {
  return `rl:${senderId}:${windowId(ts)}`;
}

export async function reserveSendSlot({
  senderId,
  batchId,
  hourlyLimit,
  minDelayMs,
  now = Date.now(),
}: SendSlotRequest): Promise<SendSlotReservation> {
  const effectiveBatchLimit = Math.min(
    Math.max(1, hourlyLimit),
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  );
  const effectiveDelay = Math.max(0, minDelayMs);

  const [code, retryAt] = await (connection as RedisWithCommand).reserveSendSlot(
    batchRateLimitKey(batchId, senderId, now),
    rateLimitKey(senderId, now),
    `rl:last:${senderId}`,
    now,
    effectiveDelay,
    effectiveBatchLimit,
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    WINDOW_MS * 2,
  );

  if (code === 1) return { allowed: true };

  if (code === 0) {
    return {
      allowed: false,
      reason: 'delay',
      retryAt: Math.max(now + 50, Number(retryAt) || now + 50),
    };
  }

  return { allowed: false, reason: 'hourly', retryAt: nextWindowStart(now) };
}
