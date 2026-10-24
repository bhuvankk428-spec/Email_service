import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const setupOnly = process.argv.includes('--setup-only');
const children = [];
let shuttingDown = false;

function info(message) {
  console.log(`[setup] ${message}`);
}

function heading(step, title) {
  console.log(`\n[setup ${step}/5] ${title}`);
}

function fail(message) {
  console.error(`\n[setup] ERROR: ${message}\n`);
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnCapture(command, args, cwd = root) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: isWindows,
      windowsHide: true,
    });

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: -1, output: error.message }));
    child.on('close', (code) => resolve({ code, output: `${stdout}${stderr}`.trim() }));
  });
}

function runVisible(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      shell: isWindows,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`command exited with code ${code}`));
    });
  });
}

function pipeWithPrefix(stream, prefix, target) {
  if (!stream) return;
  createInterface({ input: stream }).on('line', (text) => {
    target.write(`${prefix} ${text}\n`);
  });
}

function runStreamed(prefix, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeWithPrefix(child.stdout, prefix, process.stdout);
    pipeWithPrefix(child.stderr, prefix, process.stderr);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`command exited with code ${code}`));
    });
  });
}

function setEnvValue(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, `${key}=${value}`);
  return `${content.replace(/\s*$/, '')}\n${key}=${value}\n`;
}

function ensureEnvFile(targetRel, exampleRel, mutate) {
  const target = path.join(root, targetRel);
  if (existsSync(target)) {
    info(`${targetRel} already exists; leaving it unchanged.`);
    return;
  }

  const example = path.join(root, exampleRel);
  if (!existsSync(example)) {
    fail(`${exampleRel} is missing, so ${targetRel} could not be created.`);
  }

  const initial = readFileSync(example, 'utf8');
  const content = mutate(initial).replace(/\s*$/, '\n');
  writeFileSync(target, content, 'utf8');
  info(`Created ${targetRel}.`);
}

function readEnvFile(fileRel) {
  const values = {};
  for (const rawLine of readFileSync(path.join(root, fileRel), 'utf8').split(/\r?\n/)) {
    const text = rawLine.trim();
    if (!text || text.startsWith('#')) continue;
    const separator = text.indexOf('=');
    if (separator <= 0) continue;
    const key = text.slice(0, separator).trim();
    let value = text.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function parseEndpoint(value, name) {
  try {
    return new URL(value);
  } catch {
    fail(`${name} in backend/.env is not a valid URL.`);
  }
}

function isLocalHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

async function waitForServices(services) {
  const checks = {
    postgres: {
      label: 'PostgreSQL',
      args: [
        'compose',
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        'scheduler',
        '-d',
        'reachinbox_scheduler',
      ],
    },
    redis: {
      label: 'Redis',
      args: ['compose', 'exec', '-T', 'redis', 'redis-cli', 'ping'],
    },
  };

  const pending = new Set(services);
  const deadline = Date.now() + 120_000;

  while (pending.size > 0 && Date.now() < deadline) {
    for (const service of [...pending]) {
      const result = await spawnCapture('docker', checks[service].args);
      if (result.code === 0) {
        info(`${checks[service].label} is ready.`);
        pending.delete(service);
      }
    }
    if (pending.size > 0) await delay(1000);
  }

  if (pending.size > 0) {
    fail(`Timed out waiting for ${[...pending].join(' and ')}. Run docker compose logs and try again.`);
  }
}

async function ensureDockerServices(databaseUrl, redisUrl, needsRedis) {
  const databaseIsFile = databaseUrl.startsWith('file:');
  const needsPostgres = !databaseIsFile && isLocalHost(parseEndpoint(databaseUrl, 'DATABASE_URL').hostname);

  if (!needsPostgres && !needsRedis) {
    info('No Docker services are needed for this configuration.');
    return;
  }

  const docker = await spawnCapture('docker', ['info']);
  if (docker.code !== 0) {
    fail(
      'Docker Desktop is required only for the PostgreSQL/Redis option. Set DATABASE_URL=file:./dev.db and QUEUE_DRIVER=local in backend/.env for the no-dependency setup.',
    );
  }

  const compose = await spawnCapture('docker', ['compose', 'version']);
  if (compose.code !== 0) {
    fail('Docker Compose v2 is required when running the PostgreSQL/Redis option.');
  }

  const services = [];
  if (needsPostgres) services.push('postgres');
  if (needsRedis) services.push('redis');

  info(`Starting ${services.join(' and ')} in Docker (images download once on the first run).`);
  const up = await spawnCapture('docker', ['compose', 'up', '-d', ...services]);
  if (up.code !== 0) {
    if (up.output) console.error(up.output);
    fail('Could not start PostgreSQL/Redis. Make sure Docker Desktop is running and the ports are free.');
  }

  await waitForServices(services);
}

function needsInstall(dirRel, markerRel) {
  const dir = path.join(root, dirRel);
  if (!existsSync(path.join(dir, markerRel))) return true;

  const lock = path.join(dir, 'package-lock.json');
  const stamp = path.join(dir, 'node_modules', '.package-lock.json');
  if (!existsSync(lock) || !existsSync(stamp)) return true;

  return statSync(lock).mtimeMs > statSync(stamp).mtimeMs + 1000;
}

async function ensureDependencies() {
  const packages = [
    { dir: 'backend', label: 'backend', marker: path.join('node_modules', '@prisma', 'client') },
    { dir: 'frontend', label: 'frontend', marker: path.join('node_modules', 'next') },
  ].filter((entry) => needsInstall(entry.dir, entry.marker));

  if (packages.length === 0) {
    info('Dependencies are already installed.');
    return;
  }

  info('Installing dependencies (first run only, usually 1-3 minutes)...');

  await Promise.all(
    packages.map(async (entry) => {
      const cwd = path.join(root, entry.dir);
      const hasLock = existsSync(path.join(cwd, 'package-lock.json'));
      const args = hasLock
        ? ['ci', '--no-audit', '--no-fund']
        : ['install', '--no-audit', '--no-fund'];
      try {
        await runStreamed(`[${entry.label}]`, npm, args, cwd);
      } catch {
        fail(
          `Dependency installation failed for ${entry.label}. Check your internet connection and run npm run dev again.`,
        );
      }
    }),
  );
}

async function runBackendScript(script, failureMessage) {
  try {
    await runVisible(npm, ['run', script], path.join(root, 'backend'));
  } catch {
    fail(failureMessage);
  }
}

async function ensureDatabase(databaseUrl) {
  info('Generating the Prisma clients...');
  await runBackendScript(
    'prisma:generate',
    'Prisma client generation failed. Stop any running dev server and retry; if it still fails, reinstall dependencies.',
  );

  if (databaseUrl.startsWith('file:')) {
    info('Applying the SQLite schema...');
    await runBackendScript(
      'db:local',
      'Local SQLite setup failed. Check that backend/.env has DATABASE_URL=file:./dev.db and retry.',
    );
    return;
  }

  info('Applying PostgreSQL migrations...');
  await runBackendScript(
    'prisma:deploy',
    'Database migration failed. Check that PostgreSQL is running and DATABASE_URL is correct.',
  );
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function ensurePorts(backendPort) {
  const ports = [
    { port: backendPort, label: 'API' },
    { port: 3000, label: 'dashboard' },
  ];

  for (const entry of ports) {
    if (!(await isPortFree(entry.port))) {
      fail(
        `Port ${entry.port} (${entry.label}) is already in use. Stop the other process and run npm run dev again.`,
      );
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.pid) continue;
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), isWindows ? 1000 : 300);
}

function startApp(backendPort, queueDriver, mailTransport, databaseIsFile) {
  const services =
    queueDriver === 'local'
      ? [
          { name: 'api', dir: 'backend', args: ['run', 'dev'], env: { EMBED_WORKER: 'true' } },
          { name: 'web', dir: 'frontend', args: ['run', 'dev'], env: {} },
        ]
      : [
          { name: 'api', dir: 'backend', args: ['run', 'dev'], env: { EMBED_WORKER: 'false' } },
          { name: 'worker', dir: 'backend', args: ['run', 'worker'], env: {} },
          { name: 'web', dir: 'frontend', args: ['run', 'dev'], env: {} },
        ];

  for (const service of services) {
    const child = spawn(npm, service.args, {
      cwd: path.join(root, service.dir),
      env: { ...process.env, ...service.env },
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);

    const prefix = `[${service.name}]`;
    pipeWithPrefix(child.stdout, prefix, process.stdout);
    pipeWithPrefix(child.stderr, prefix, process.stderr);

    child.on('error', (error) => {
      console.error(`${prefix} failed to start: ${error.message}`);
      shutdown(1);
    });

    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`${prefix} stopped (${reason}). Shutting down the local stack.`);
      shutdown(1);
    });
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  console.log('');
  console.log('  Local stack is starting:');
  console.log(`    Dashboard  http://localhost:3000`);
  console.log(`    API        http://localhost:${backendPort}`);
  console.log(`    Health     http://localhost:${backendPort}/health`);
  console.log(`    Database   ${databaseIsFile ? 'SQLite (backend/prisma/dev.db)' : 'PostgreSQL'}`);
  console.log(`    Queue      ${queueDriver === 'local' ? 'in-process local worker' : 'BullMQ + Redis'}`);
  console.log(`    Mail       ${mailTransport === 'local' ? 'backend/.mail-outbox (.eml files)' : 'Ethereal test SMTP'}`);
  console.log('');
  console.log('  Sign in with "Continue in local demo mode".');
  console.log('  The first page can take a few seconds to compile.');
  console.log('  Press Ctrl+C to stop the local stack.');
  console.log('');
}

async function main() {
  console.log('');
  console.log('  ReachInbox local setup');
  console.log('  ----------------------');
  console.log(`  Node ${process.version} on ${process.platform}`);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    fail(`Node.js 20 or newer is required. You have ${process.version}. Install Node 20+ and try again.`);
  }

  heading(1, 'Preparing local configuration');
  if (!existsSync(path.join(root, 'backend', '.env.example'))) {
    fail('backend/.env.example is missing. Download the complete project folder and try again.');
  }
  ensureEnvFile('backend/.env', 'backend/.env.example', (content) => {
    let next = setEnvValue(content, 'JWT_SECRET', randomBytes(32).toString('hex'));
    next = setEnvValue(next, 'DEV_AUTH_ENABLED', 'true');
    return next;
  });
  ensureEnvFile('frontend/.env.local', 'frontend/.env.example', (content) =>
    setEnvValue(content, 'NEXT_PUBLIC_DEV_AUTH_ENABLED', 'true'),
  );

  const backendEnv = readEnvFile('backend/.env');
  if (!backendEnv.DATABASE_URL) {
    fail('DATABASE_URL is missing from backend/.env. Add it, then run npm run dev again.');
  }

  const queueDriver = backendEnv.QUEUE_DRIVER || 'local';
  if (queueDriver !== 'local' && queueDriver !== 'bullmq') {
    fail('QUEUE_DRIVER in backend/.env must be local or bullmq.');
  }
  const mailTransport = backendEnv.MAIL_TRANSPORT || 'local';
  if (mailTransport !== 'local' && mailTransport !== 'ethereal') {
    fail('MAIL_TRANSPORT in backend/.env must be local or ethereal.');
  }
  const needsRedis = queueDriver === 'bullmq';
  if (needsRedis && !backendEnv.REDIS_URL) {
    fail('REDIS_URL is required when QUEUE_DRIVER is bullmq.');
  }

  const backendPort = Number(backendEnv.PORT || 4000);
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    fail('PORT in backend/.env must be a number between 1 and 65535.');
  }
  const databaseIsFile = backendEnv.DATABASE_URL.startsWith('file:');

  if (!setupOnly) await ensurePorts(backendPort);

  heading(2, 'Installing dependencies');
  await ensureDependencies();

  heading(3, 'Preparing optional services');
  await ensureDockerServices(backendEnv.DATABASE_URL, backendEnv.REDIS_URL, needsRedis);

  heading(4, 'Preparing the database');
  await ensureDatabase(backendEnv.DATABASE_URL);

  heading(5, 'Starting the app');
  if (setupOnly) {
    console.log('');
    console.log('  Setup complete. Start everything with:');
    console.log('    npm run dev');
    console.log('');
    console.log('  Then open http://localhost:3000 and click "Continue in local demo mode".');
    console.log('');
    return;
  }

  startApp(backendPort, queueDriver, mailTransport, databaseIsFile);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
