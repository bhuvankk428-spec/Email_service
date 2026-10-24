# How to Run Locally

One command does the setup. You only need Node.js. Docker, PostgreSQL, Redis,
Supabase, and an SMTP account are not required for the default local mode.

## 1. Install Node.js 20 or newer

Download it from <https://nodejs.org>. The first setup needs an internet
connection to install npm packages. After that, the local app runs offline.

## 2. Start everything

Open a terminal in the repository root and run:

```bash
npm run dev
```

That is the whole setup. The first run takes roughly 2-5 minutes and
automatically:

1. Creates `backend/.env` and `frontend/.env.local` with local demo settings
   and a random `JWT_SECRET`.
2. Installs backend and frontend dependencies.
3. Generates the PostgreSQL and SQLite Prisma clients.
4. Creates the SQLite database at `backend/prisma/dev.db`.
5. Starts the API with its embedded local worker and the dashboard.

No containers are started. No database server, Redis instance, or Google
credentials are needed. Later runs take only a few seconds because completed
steps are skipped.

## 3. Use the app

Open <http://localhost:3000> and click **Continue in local demo mode**. The
first sign-in creates synthetic `@outbox.local` senders for that user. This is
instant and does not need internet access.

Schedule a batch with **Now** or a future start time. The local worker polls
the SQLite database every 400 ms and delivers due messages by writing one file
per email under `backend/.mail-outbox`. Open a `.eml` file in any mail client to
inspect the message. Local messages have no preview URL, so the dashboard does
not show a preview link for them; the row still moves to Sent.

Press `Ctrl+C` to stop the API and dashboard. There are no background services
to stop.

## Optional: production-shaped mode on your machine

The same codebase can run the hosted architecture locally: PostgreSQL, Redis,
BullMQ, a separate worker, and Ethereal SMTP. This is optional and mainly useful
for testing delivery behavior before deploying.

1. Start Docker Desktop.
2. Edit `backend/.env`:

   ```text
   DATABASE_URL=postgresql://scheduler:scheduler@localhost:5432/reachinbox_scheduler?schema=public
   QUEUE_DRIVER=bullmq
   MAIL_TRANSPORT=ethereal
   REDIS_URL=redis://localhost:6379
   ```

3. Run `npm run dev` again.

When `DATABASE_URL` and `REDIS_URL` point at localhost, the bootstrap starts
PostgreSQL and Redis with Docker Compose and applies Prisma migrations. It then
starts the API, a separate BullMQ worker, and the dashboard. Each user's
Ethereal sender pool is created on first sign-in, which needs outbound internet
access. Delivered rows show Ethereal preview links.

To return to the zero-dependency mode, set `DATABASE_URL=file:./dev.db`,
`QUEUE_DRIVER=local`, `MAIL_TRANSPORT=local`, and empty `REDIS_URL`, then run
`npm run dev` again. The SQLite database is reused; data created in the
PostgreSQL database is separate.

## Docker-only option

If you do not want to install Node.js, Docker can run the production-shaped
stack:

```bash
docker compose up --build
```

Then open <http://localhost:3000>. The first build takes roughly 3-8 minutes;
later starts are faster with `docker compose up`. Stop everything with
`Ctrl+C` and `docker compose down`. No env file is required. Compose forces
`QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal`, so it needs outbound
internet access for Ethereal sender provisioning and previews.

Do not run this option at the same time as `npm run dev`; both use ports 3000,
4000, 5432, and 6379. The built-in defaults are for a local demo only. Do not
expose this stack to the internet; set `NODE_ENV=production`, a strong
`JWT_SECRET`, `DEV_AUTH_ENABLED=false`, HTTPS URLs, and Google OAuth
credentials first. The backend refuses to start in production without them.

## Hosted production: Vercel dashboard and Render backend

Local demo login is not available in production. The hosted layout uses Google
OAuth and two long-running Render processes: the API and a separate BullMQ
worker. It uses PostgreSQL and Key Value instead of SQLite and the local
outbox.

1. **Vercel**: create a project from this repository with Root Directory
   `frontend`, then set `NEXT_PUBLIC_API_BASE_URL=/api`,
   `NEXT_PUBLIC_DEV_AUTH_ENABLED=false`, and
   `API_PROXY_TARGET=https://<render-api-host>` for Production. Redeploy after
   changing `API_PROXY_TARGET`.
2. **Google Cloud Console**: add
   `https://<frontend-host>/api/auth/google/callback` as an authorized redirect
   URI.
3. **Render**: create a Blueprint from `render.yaml`. Enter `FRONTEND_URL`,
   `GOOGLE_CALLBACK_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` when
   prompted. The Blueprint creates Postgres, Key Value, the API, and the
   background worker, sets `QUEUE_DRIVER=bullmq` and
   `MAIL_TRANSPORT=ethereal`, and runs `prisma migrate deploy` before each
   deploy.
4. Use paid Render plans. Free web services sleep, free Key Value is not
   durable, and free web services block the SMTP ports needed for Ethereal
   delivery. The background worker is already paid in the Blueprint.

The full runbook, environment tables, deploy order, verification commands, and
troubleshooting are in [DEPLOYMENT.md](DEPLOYMENT.md). Ethereal remains a test
sandbox; hosted messages open in the Ethereal preview inbox, not a real mailbox.
Do not deploy SQLite or the local outbox to Render.

## Ports

| Service | Address |
| --- | --- |
| Dashboard | <http://localhost:3000> |
| API | <http://localhost:4000> |
| API health | <http://localhost:4000/health> |
| Local database | `backend/prisma/dev.db` |
| Local outbox | `backend/.mail-outbox/*.eml` |
| PostgreSQL (optional mode) | `localhost:5432`, database/user/password `reachinbox_scheduler` / `scheduler` / `scheduler` |
| Redis (optional mode) | `localhost:6379` |

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Set up anything missing, then start the local stack |
| `npm start` | Same as `npm run dev` |
| `npm run setup` | Prepare everything but do not start the apps |
| `npm run test:local` | Run the automated zero-dependency end-to-end check |
| `docker compose up --build` | Run the production-shaped stack in Docker |
| `docker compose down` | Stop the Docker services (keeps data) |
| `cd backend && npm test` | Run the backend test suite |
| `cd backend && npm run test:load -- 1000` | Benchmark 1,000 jobs (needs Redis) |

Service logs are prefixed with `[api]`, `[worker]`, and `[web]`. Local mode has
no separate worker process; its worker logs appear under `[api]`. If one
process stops, the whole local stack shuts down so the failure is visible.

## Configuration

The setup script only creates files that do not exist. It never overwrites your
settings.

| File | Used by | Created automatically |
| --- | --- | --- |
| `backend/.env` | Local `npm run dev` | Yes, with a random `JWT_SECRET` |
| `frontend/.env.local` | Local `npm run dev` | Yes |
| `.env` in the repository root | Docker Compose overrides | No, optional |

Both generated files are git-ignored. Useful backend values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | SQLite file locally; PostgreSQL URL for hosted mode |
| `QUEUE_DRIVER` | `local` | `local` database poller or `bullmq` Redis queue |
| `MAIL_TRANSPORT` | `local` | `.eml` outbox or Ethereal SMTP |
| `LOCAL_OUTBOX_DIR` | `.mail-outbox` | Local `.eml` output directory |
| `REDIS_URL` | empty | Required only when `QUEUE_DRIVER=bullmq` |
| `DEV_AUTH_ENABLED` | `true` in the example | Shows the local demo login |
| `JWT_SECRET` | generated | Signs the session cookie |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Minimum gap between sends per sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Server-wide hourly cap per sender |
| `RATE_WINDOW_MS` | `3600000` | Hourly window; use `60000` for fast demos |
| `SENDER_COUNT` | `3` | Senders provisioned per user |
| `WORKER_CONCURRENCY` | `5` | Jobs a BullMQ worker may process in parallel |
| `EMBED_WORKER` | `true` in development | Runs the delivery worker inside the API |

For local runs, edit `backend/.env` and restart `npm run dev`. For Docker, put
the same variables in a root `.env` file before `docker compose up -d`.

The queue and mail defaults depend on `NODE_ENV`: development uses `local` and
`local`; production uses `bullmq` and `ethereal`. Setting the variables
explicitly overrides those defaults. `REDIS_URL` is required only when the queue
driver is `bullmq`.

To add senders for existing users, raise `SENDER_COUNT` and run the repair
command after at least one sign-in:

```bash
cd backend
npm run seed:senders
```

For Docker, set `SENDER_COUNT` in the root `.env`, then run:

```bash
docker compose run --rm migrate npm run seed:senders
```

Each user has a separate pool. Raising `SENDER_COUNT` affects every user the
next time they are provisioned; it does not share senders between users.
Legacy senders without an owner remain only as a fallback for users who have no
owned senders. In local mode, the repair command creates synthetic
`@outbox.local` senders instead of contacting Ethereal.

## Tests

The zero-dependency end-to-end check starts its own API on a free port with a
temporary SQLite database and outbox. It signs in, schedules and delivers
messages, checks the `.eml` files, cancels a single row and the whole queue,
simulates an interrupted `PROCESSING` row across a restart, verifies stats, and
cleans up. It does not use ports 3000/4000 or your real database:

```bash
npm run test:local
```

The unit suite and builds:

```bash
cd backend
npm run typecheck
npm test
npm run build

cd ../frontend
npm run lint
npx tsc --noEmit
npm run build
```

The backend suite has 32 tests. `test/load1000.test.ts` plans 1,000 recipients
and verifies two 500-job bulk-enqueue chunks. `test/localPacer.test.ts` covers
the local delay and hourly limits. `test/senders.test.ts` covers local and
Ethereal sender provisioning.

The Redis benchmark is separate from the local mode. It requires
`QUEUE_DRIVER=bullmq` and a reachable Redis, and never touches the application
queue:

```bash
cd backend
npm run test:load -- 1000
```

It reports planning time, enqueue time, planned windows, and job counts, then
removes its test queue.

## Google OAuth (optional locally)

Local demos use the demo login. Google login is required in production. Local
runs use `http://localhost:4000/api/auth/google/callback`; Docker uses
`http://localhost:3000/api/auth/google/callback`; Vercel uses
`https://<frontend-host>/api/auth/google/callback`. Put `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `backend/.env` for local
runs or in the root `.env` for Docker. `FRONTEND_URL` must be the exact
dashboard origin without a trailing slash.

## Signing in

- **Local demo mode** works out of the box and creates a real database user.
- **Google login** works after the OAuth values above are configured.
- The demo endpoint is rejected when `NODE_ENV=production`. Email/password login
  does not exist.

## Scheduling controls

The compose screen exposes:

- **Start time**: a preset (including **Now**) or a custom date/time. A time at
  or before now sends immediately.
- **Delay between emails**, in seconds
- **Hourly limit**, per sender

The browser values are validated again by the API and cannot exceed the server
limits. `MIN_DELAY_BETWEEN_EMAILS_MS` is the floor. The hourly limit you enter
applies to the current batch, per sender, and
`MAX_EMAILS_PER_HOUR_PER_SENDER` applies to each sender across all batches; the
lower value is enforced. Local mode applies these limits with its in-process
pacer; BullMQ mode applies them with Redis.

Capacity per window is `senders in that user's pool x min(entered hourly limit,
server cap)`. With the defaults (3 senders per user, cap 100), one user's 1,500
recipients are planned as 300 in the first window, 300 in the next, and so on.
At a 2-second gap, each sender is paced independently; the rest wait for their
assigned windows. Another user's pool runs in parallel. This is the rate limit
working, not a stalled queue.

To move a large batch faster for a demo, change these in `backend/.env` (or the
root `.env` for Docker) and restart:

| Goal | Configuration |
| --- | --- |
| 1,500 in the first window | `MAX_EMAILS_PER_HOUR_PER_SENDER=1000`, enter an hourly limit of 1000 or more |
| 3,000/hour per user with a 200 cap | `SENDER_COUNT=15`, then run the repair command after sign-in |
| Show window rollover in about a minute | `RATE_WINDOW_MS=60000`, `MAX_EMAILS_PER_HOUR_PER_SENDER=3` |

Rows are planned only when the batch is submitted. After changing these values,
use **Delete all scheduled** and submit the unsent recipients again.

## Demo checklist (about 5 minutes)

1. Show the demo login and the user name, email, and avatar.
2. Compose a batch with recipients, a start time (**Now** sends immediately),
   delay, and hourly limit.
3. Open `backend/.mail-outbox` and show the matching `.eml` files.
4. Show the Scheduled tab, then the Sent tab with statuses and times.
5. Cancel one scheduled email, then use **Delete all scheduled**.
6. Show a low hourly limit causing the next window to be used.
7. Restart `npm run dev` and show that pending emails are restored.
8. Run `npm run test:local`.
9. Optionally run `npm run test:load -- 1000` if Redis is available.

## Restart persistence checks

Local mode:

1. Schedule several emails a few minutes ahead.
2. Stop the stack with `Ctrl+C`.
3. Run `npm run dev` again.
4. Confirm the local worker logs that it released interrupted rows and that
   pending emails still send at their planned times.

BullMQ mode (optional or hosted):

1. Schedule several emails a few minutes ahead.
2. Stop the API and worker, then start them again.
3. Confirm the worker logs `reconcile complete` and each email is sent once.
4. Optionally flush Redis and restart; scheduled rows are rebuilt from
   PostgreSQL.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Node.js 20 or newer is required` | Install a current Node.js release and reopen the terminal. |
| Dependency installation failed | Check the internet connection, then run `npm run dev` again. |
| Port 3000 or 4000 already in use | Stop the other process, or run `docker compose down` if the Docker stack is running. |
| Ports 5432 or 6379 already in use | Only relevant to the optional PostgreSQL/Redis mode; stop the other service or run `docker compose down`. |
| Docker error during setup | The default mode does not use Docker. Check that `backend/.env` still has `DATABASE_URL=file:./dev.db`, `QUEUE_DRIVER=local`, and an empty `REDIS_URL`. |
| First schedule returns `503 NO_SENDERS` in local mode | Run `cd backend && npm run seed:senders`; local sender creation does not need the internet. |
| First schedule pauses in Ethereal mode | The API is creating that user's Ethereal senders; this needs internet access. |
| Demo login button missing | Set `DEV_AUTH_ENABLED=true` in `backend/.env` and `NEXT_PUBLIC_DEV_AUTH_ENABLED=true` in `frontend/.env.local`, then restart. |
| API returns 503 on `/health` | In local mode, check that `backend/prisma/dev.db` exists and is writable. In BullMQ mode, check PostgreSQL and Redis. |
| No `.eml` files appear | Confirm the email reached Sent. Files are written only at send time, under `backend/.mail-outbox` unless `LOCAL_OUTBOX_DIR` is changed. |
| Google redirect mismatch | Make `GOOGLE_CALLBACK_URL` exactly match the URI registered in Google Console. |
| Only 600 of 1,500 emails sent | The hourly cap is working. See the capacity table above or raise the limits for the demo. |
| BullMQ warns about `volatile-lru` | Use the Compose Redis (`noeviction`) instead of another local Redis instance. |
| Start over with an empty local database | Stop the app, delete `backend/prisma/dev.db` and `backend/.mail-outbox`, then run `npm run dev`. |
| Start over with the Docker stack | Run `docker compose down -v`. This deletes all local emails, users, and senders. Then run `npm run dev`. |
