import { Queue } from 'bullmq';
import { env } from '../src/config/env.js';
import { connection } from '../src/lib/redis.js';
import { enqueueInChunks, toJob } from '../src/queue/jobPayload.js';
import { planSchedule } from '../src/services/planner.js';

const requested = Number(process.argv[2] ?? 1000);

if (!Number.isInteger(requested) || requested < 1 || requested > 10_000) {
  console.error('Usage: npm run test:load -- [1-10000]');
  process.exit(1);
}

const runId = Date.now();
const senderCount = Math.max(1, env.SENDER_COUNT);
const senders = Array.from({ length: senderCount }, (_, index) => ({
  id: `load-sender-${index + 1}`,
}));

const planStarted = performance.now();
const planned = planSchedule({
  count: requested,
  senders,
  startTime: Date.now() + 1000,
  delayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
  limit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  usage: new Map(),
});
const planMs = performance.now() - planStarted;

const emails = planned.map((item, index) => ({
  id: `load-${runId}-${index}`,
  scheduledAt: item.scheduledAt,
}));

const queue = new Queue(`email-send-loadtest-${runId}`, { connection });

async function main(): Promise<void> {
  const enqueueStarted = performance.now();
  await enqueueInChunks(
    emails.map(toJob),
    (chunk) => queue.addBulk(chunk),
    500,
  );
  const enqueueMs = performance.now() - enqueueStarted;
  const counts = await queue.getJobCounts('waiting', 'delayed', 'active');

  const windows = new Set(planned.map((item) => item.scheduledAt.getTime()));
  const windowCount = new Set(
    planned.map((item) => Math.floor(item.scheduledAt.getTime() / env.RATE_WINDOW_MS)),
  ).size;

  console.log(
    JSON.stringify(
      {
        recipients: requested,
        senders: senderCount,
        delayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
        hourlyLimitPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        plannedWindows: windowCount,
        distinctStartTimes: windows.size,
        planMs: Number(planMs.toFixed(2)),
        enqueueMs: Number(enqueueMs.toFixed(2)),
        queueName: queue.name,
        jobs: counts,
        smtpSent: 0,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Load test failed. Is Redis running?', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    } catch {
      process.exitCode = 1;
    }
  });
