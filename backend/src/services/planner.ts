import { nextWindowStart, windowId } from '../lib/window.js';

export interface PlannerSender {
  id: string;
}

export interface PlannedEmail {
  senderId: string;
  scheduledAt: Date;
  seq: number;
}

export interface PlanScheduleInput {
  count: number;
  senders: PlannerSender[];
  startTime: number;
  delayMs: number;
  limit: number;

  usage: Map<string, number>;
}

export function planSchedule({
  count,
  senders,
  startTime,
  delayMs,
  limit,
  usage,
}: PlanScheduleInput): PlannedEmail[] {
  if (senders.length === 0) {
    throw new Error('planSchedule requires at least one sender');
  }
  if (limit < 1) {
    throw new Error('planSchedule requires limit >= 1');
  }

  const cursor = new Map(senders.map((sender) => [sender.id, startTime]));
  const used = new Map<string, number>(usage);

  return Array.from({ length: count }, (_, index) => {
    const sender = senders[index % senders.length]!;
    let slot = cursor.get(sender.id)!;
    let key = `${sender.id}:${windowId(slot)}`;

    while ((used.get(key) ?? 0) >= limit) {
      slot = nextWindowStart(slot);
      key = `${sender.id}:${windowId(slot)}`;
    }

    used.set(key, (used.get(key) ?? 0) + 1);
    cursor.set(sender.id, slot + delayMs);

    return { senderId: sender.id, scheduledAt: new Date(slot), seq: index };
  });
}
