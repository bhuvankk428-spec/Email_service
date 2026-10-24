import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const isWindows = process.platform === 'win32';
const runId = String(process.pid);
const databaseUrl = `file:./smoke-${runId}.db`;
const databaseFiles = ['', '-journal', '-shm', '-wal'].map((suffix) =>
  path.join(backend, 'prisma', `smoke-${runId}.db${suffix}`),
);
const outbox = path.join(backend, `.mail-outbox-smoke-${runId}`);
const tsx = path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const prismaCli = path.join(backend, 'node_modules', 'prisma', 'build', 'index.js');
const jwtSecret = randomBytes(32).toString('hex');

let child = null;
let logs = '';

function log(message) {
  console.log(`[smoke] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      child = null;
      resolve();
      return;
    }

    const stopping = child;
    child = null;
    stopping.once('exit', () => resolve());
    if (isWindows) {
      spawn('taskkill', ['/pid', String(stopping.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      stopping.kill('SIGTERM');
    }
    setTimeout(resolve, 5000).unref();
  });
}

async function startServer(port) {
  logs = '';
  child = spawn(process.execPath, [tsx, 'src/server.ts'], {
    cwd: backend,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      FRONTEND_URL: 'http://localhost:3000',
      DATABASE_URL: databaseUrl,
      QUEUE_DRIVER: 'local',
      MAIL_TRANSPORT: 'local',
      LOCAL_OUTBOX_DIR: outbox,
      REDIS_URL: '',
      JWT_SECRET: jwtSecret,
      DEV_AUTH_ENABLED: 'true',
      EMBED_WORKER: 'true',
      SENDER_COUNT: '2',
      MIN_DELAY_BETWEEN_EMAILS_MS: '50',
      MAX_EMAILS_PER_HOUR_PER_SENDER: '20',
      RATE_WINDOW_MS: '3600000',
      CLAIM_TTL_MS: '120000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited during startup\n${logs}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }

  throw new Error(`API did not become healthy\n${logs}`);
}

function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie')];
  return values.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

async function request(base, pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { response, body };
}

async function waitFor(check, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function createInterruptedEmail() {
  process.env.DATABASE_URL = databaseUrl;
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require(
    path.join(backend, 'generated', 'sqlite-client', 'index.js'),
  );
  const db = new PrismaClient();

  try {
    const user = await db.user.findFirst();
    const sender = await db.sender.findFirst({ where: { userId: user.id } });
    const batch = await db.batch.create({
      data: {
        userId: user.id,
        subject: 'Restart recovery',
        body: '<p>recovered after restart</p>',
        startTime: new Date(),
        delayMs: 0,
        hourlyLimit: 20,
        total: 1,
        idempotencyKey: `recovery-${runId}`,
      },
    });

    await db.email.create({
      data: {
        batchId: batch.id,
        userId: user.id,
        senderId: sender.id,
        toEmail: 'recovered@example.com',
        subject: batch.subject,
        body: batch.body,
        seq: 0,
        scheduledAt: new Date(),
        status: 'PROCESSING',
        claimedAt: new Date(),
        attempts: 1,
      },
    });
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  log('creating a temporary SQLite database');
  const push = spawnSync(
    process.execPath,
    [prismaCli, 'db', 'push', '--schema', 'prisma/schema.sqlite.prisma', '--skip-generate'],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (push.status !== 0) {
    throw new Error(`prisma db push failed\n${push.stdout}\n${push.stderr}`);
  }

  log('starting the API with the embedded local worker');
  await startServer(port);

  const health = await request(base, '/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.queueDriver, 'local');

  const login = await request(base, '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(login.response.status, 200);
  const cookie = cookieFrom(login.response);
  assert.ok(cookie, 'dev login should set a session cookie');

  const headers = { 'content-type': 'application/json', cookie };
  const schedule = await request(base, '/api/emails/schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      subject: 'SQLite smoke',
      body: '<p>local delivery works</p>',
      recipients: ['one@example.com', 'two@example.com', 'three@example.com'],
      startAt: new Date().toISOString(),
      delayBetweenEmailsMs: 0,
      maxEmailsPerHour: 10,
      idempotencyKey: `smoke-send-${runId}`,
    }),
  });
  assert.equal(schedule.response.status, 202, JSON.stringify(schedule.body));

  await waitFor(async () => {
    const sent = await request(base, '/api/emails/sent?limit=20', { headers: { cookie } });
    return (
      sent.response.status === 200 &&
      sent.body.items.filter((item) => item.status === 'sent').length === 3
    );
  }, 'three local deliveries');

  const sent = await request(base, '/api/emails/sent?limit=20', { headers: { cookie } });
  for (const item of sent.body.items) {
    assert.equal(item.status, 'sent');
    assert.match(item.sender, /@outbox\.local$/);
    assert.equal(item.previewUrl, null);
  }

  const files = await readdir(outbox);
  assert.equal(files.length, 3);
  const contents = await Promise.all(
    files.map((file) => readFile(path.join(outbox, file), 'utf8')),
  );
  assert.ok(contents.every((content) => content.includes('Subject: SQLite smoke')));
  assert.ok(
    contents.every((content) => content.includes('<p>local delivery works</p>')),
  );

  log('verifying single and bulk cancellation');
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const futureOne = await request(base, '/api/emails/schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      subject: 'Cancel one',
      body: '<p>cancel one</p>',
      recipients: ['cancel-one@example.com'],
      startAt: future,
      idempotencyKey: `cancel-one-${runId}`,
    }),
  });
  assert.equal(futureOne.response.status, 202);

  const scheduledOne = await request(base, '/api/emails/scheduled?limit=20', {
    headers: { cookie },
  });
  const scheduledEmail = scheduledOne.body.items.find(
    (item) => item.recipient === 'cancel-one@example.com',
  );
  assert.ok(scheduledEmail);
  const cancelOne = await request(base, `/api/emails/${scheduledEmail.id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(cancelOne.response.status, 200);

  const futureMany = await request(base, '/api/emails/schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      subject: 'Cancel all',
      body: '<p>cancel all</p>',
      recipients: ['cancel-a@example.com', 'cancel-b@example.com'],
      startAt: future,
      idempotencyKey: `cancel-all-${runId}`,
    }),
  });
  assert.equal(futureMany.response.status, 202);

  const cancelAll = await request(base, '/api/emails/scheduled', {
    method: 'DELETE',
    headers,
  });
  assert.equal(cancelAll.response.status, 200);
  assert.equal(cancelAll.body.deleted, 2);

  log('verifying restart recovery of an interrupted delivery');
  await stopServer();
  await createInterruptedEmail();
  await startServer(port);

  await waitFor(async () => {
    const result = await request(base, '/api/emails/sent?limit=20', {
      headers: { cookie },
    });
    return result.body.items.some(
      (item) => item.recipient === 'recovered@example.com' && item.status === 'sent',
    );
  }, 'recovered delivery');

  const stats = await request(base, '/api/emails/stats', { headers: { cookie } });
  assert.equal(stats.body.totalSent, 4);
  assert.equal(stats.body.totalScheduled, 0);
  assert.equal(stats.body.totalFailed, 0);

  log('all local-mode checks passed');
}

main()
  .catch((error) => {
    console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : error}`);
    if (logs) console.error(logs);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    await Promise.all(
      databaseFiles.map((file) => rm(file, { force: true }).catch(() => undefined)),
    );
    await rm(outbox, { recursive: true, force: true }).catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
