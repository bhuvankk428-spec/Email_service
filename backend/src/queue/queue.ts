import { Queue } from 'bullmq';
import { connection } from '../lib/redis.js';
import {
  enqueueInChunks,
  toJob,
  type EmailToEnqueue,
} from './jobPayload.js';

export { type EmailToEnqueue, toJob } from './jobPayload.js';

export const QUEUE_NAME = 'email-send';

export interface SendJobData {
  emailId: string;
}

export const queue = new Queue<SendJobData>(QUEUE_NAME, { connection });

export async function enqueueEmails(
  emails: EmailToEnqueue[],
  chunkSize = 500,
): Promise<void> {
  const jobs = emails.map(toJob);
  await enqueueInChunks(jobs, (chunk) => queue.addBulk(chunk), chunkSize);
}
