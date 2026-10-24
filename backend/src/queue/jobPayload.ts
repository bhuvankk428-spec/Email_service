import { baseJobOpts } from './jobOpts.js';

export interface EmailToEnqueue {
  id: string;
  scheduledAt: Date;
}

export function toJob(email: EmailToEnqueue) {
  return {
    name: 'send',
    data: { emailId: email.id },
    opts: {
      ...baseJobOpts,
      jobId: email.id,
      delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
    },
  };
}

export function chunkItems<T>(items: T[], chunkSize = 500): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function enqueueInChunks<T>(
  jobs: T[],
  addBulk: (chunk: T[]) => Promise<unknown>,
  chunkSize = 500,
): Promise<number> {
  let added = 0;

  for (const chunk of chunkItems(jobs, chunkSize)) {
    await addBulk(chunk);
    added += chunk.length;
  }

  return added;
}
