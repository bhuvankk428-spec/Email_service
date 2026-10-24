# ReachInbox Scheduler API

Express + TypeScript + Prisma, with two runtime modes selected by environment
variables. The default local mode uses SQLite, an in-process database poller,
and a `.eml` outbox. Production uses PostgreSQL, BullMQ + Redis, and Nodemailer
with Ethereal SMTP.

The database is the source of truth in both modes. In BullMQ mode, Redis holds
only delayed jobs and the hourly rate-limit counters, so the queue can always
be rebuilt from the database.

## Architecture

```text
POST /api/schedule
  -> validate + dedupe recipients (Zod)
  -> Postgres transaction + advisory lock
  -> plan an exact timestamp for every recipient
  -> insert Batch + Email rows
  -> enqueue one delayed job per row (jobId = email.id)

Production worker
  -> boot reconciler rebuilds Redis from Postgres
  -> atomic DB claim (SCHEDULED -> PROCESSING)
  -> Redis Lua hourly gate per sender/window
  -> Ethereal SMTP send with deterministic Message-ID
  -> SENT / FAILED, with retries and window deferral

Local worker (embedded in the API)
  -> poll due SCHEDULED rows every 400 ms
  -> in-process LocalPacer delay/hourly gate per sender
  -> atomic claim, write .eml outbox, mark SENT
```

No cron, `node-cron`, `agenda`, or scheduling `setInterval` is used. BullMQ
delayed jobs are the timer in production; local mode polls `scheduledAt`
directly.

### Why a send is not duplicated

1. `jobId = emailId` makes enqueueing idempotent.
2. The worker atomically claims a row; a fresh `PROCESSING` claim is skipped.
3. The `Message-ID` is deterministic: `<emailId@reachinbox.local>`.
4. The boot reconciler re-adds missing jobs without creating duplicates.

Delivery is at-least-once. If a worker dies after SMTP accepts a message but
before the DB update, the message can be retried after `CLAIM_TTL_MS`; the
deterministic `Message-ID` lets receivers deduplicate it. Exactly-once delivery
is impossible over SMTP.

### Rate limiting

- The compose UI sends `delayBetweenEmailsMs` and `maxEmailsPerHour`; requests
  that omit them use the server defaults.
- The planner spreads each sender's emails using the effective delay and limit.
- `delay` is floored by `MIN_DELAY_BETWEEN_EMAILS_MS`; `hourlyLimit` is capped
  by `MAX_EMAILS_PER_HOUR_PER_SENDER`.
- At send time in BullMQ mode, one Redis Lua script atomically checks both the
  batch limit and the sender-wide cap, and reserves the per-sender delay slot.
  There is no global BullMQ limiter, so different senders can send in parallel.
  Local mode enforces the same rules with an in-process pacer hydrated from the
  last 24 hours of sent rows.
- A denied job is moved to the next allowed retry time or window and re-delayed,
  never failed or dropped.
- Windows are fixed; boundary bursts of up to 2x are possible. Slots are not
  refunded on failed sends.

### Retry-safe submissions

`POST /api/schedule` accepts an optional `idempotencyKey`. It is unique per user
(`Batch.userId` + `Batch.idempotencyKey`). A retry with the same key returns the
original batch with `idempotentReplay: true`; concurrent retries race on the
unique index and the loser replays the winner. No second batch or email rows are
created.

## Setup

### One-command local setup

From the repository root:

```bash
npm run dev
```

The bootstrap creates `backend/.env` with a random `JWT_SECRET`, enables the
demo login, installs dependencies, generates both Prisma clients, creates the
SQLite database, and runs the API with its embedded local worker plus the
dashboard. No Docker, PostgreSQL, Redis, or SMTP account is required. Local
senders use synthetic `@outbox.local` addresses and messages are written to
`backend/.mail-outbox`. See [`../HOW_TO_RUN.md`](../HOW_TO_RUN.md) for details.

### Full local stack (Docker)

From the repository root:

```bash
docker compose up --build
```

No env file is needed. Compose forces `QUEUE_DRIVER=bullmq` and
`MAIL_TRANSPORT=ethereal`, then starts Postgres, Redis, a one-shot migration
service, the API, the worker, and the frontend. The migrate service runs
`prisma migrate deploy` and then repairs sender pools for users that already
exist; on a fresh database it creates none. Each user's senders are provisioned
on first sign-in, so the API container needs outbound internet access. Compose
defaults `DEV_AUTH_ENABLED=true`, so the frontend can create a real local user
session without Google credentials. The endpoint is always rejected when
`NODE_ENV=production`.

| Service | Address |
| --- | --- |
| Frontend | <http://localhost:3000> |
| API | <http://localhost:4000> |
| Postgres | `localhost:5432` (`scheduler` / `scheduler`) |
| Redis | `localhost:6379` (AOF + `noeviction`) |

For Google login through the Docker proxy, use
`http://localhost:3000/api/auth/google/callback` as the authorized redirect URI.
For direct local development, use
`http://localhost:4000/api/auth/google/callback`.

### 1. Prerequisites (manual setup)

- Node.js 20+
- No external services for the default SQLite/local mode
- Docker for the optional local Postgres/Redis mode, or hosted Postgres/Redis
- Google OAuth client credentials (optional locally when dev auth is enabled)

### 2. Environment

Skip this step if you used the one-command bootstrap; it already created
`backend/.env`. To configure manually:

```bash
cd backend
cp .env.example .env
```

The example already selects the zero-dependency mode:

```text
DATABASE_URL=file:./dev.db
QUEUE_DRIVER=local
MAIL_TRANSPORT=local
LOCAL_OUTBOX_DIR=.mail-outbox
REDIS_URL=
DEV_AUTH_ENABLED=true
```

Set a `JWT_SECRET` (the bootstrap generates one; the example contains a local
placeholder). To use the production-shaped mode locally, switch to:

```text
DATABASE_URL=postgresql://scheduler:scheduler@localhost:5432/reachinbox_scheduler?schema=public
QUEUE_DRIVER=bullmq
MAIL_TRANSPORT=ethereal
REDIS_URL=redis://localhost:6379
DEV_AUTH_ENABLED=true
```

For Supabase production, use the **Session pooler or direct connection (port
5432)**, not the transaction pooler (port 6543), so `prisma migrate` works:

```text
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

`FRONTEND_URL` must be the exact browser origin allowed by CORS (no trailing
slash). In production with a cross-site frontend, set `COOKIE_SAMESITE=none`.

### 3. Install and migrate

```bash
npm install
npm run prisma:generate
npm run db:local
```

`prisma:generate` builds both clients: the default PostgreSQL client and the
custom SQLite client in `generated/sqlite-client`. `db:local` pushes the SQLite
schema. For PostgreSQL, use `npx prisma migrate deploy` instead of `db:local`;
for local PostgreSQL schema changes, use `npm run prisma:migrate`.

Senders are provisioned per user on first sign-in. In local mode the API creates
`SENDER_COUNT` synthetic `@outbox.local` senders. In Ethereal mode it creates
`SENDER_COUNT` Ethereal accounts, stores their SMTP credentials in `Sender` with
the owning user ID, and uses only that user's senders for new batches. Ethereal
provisioning needs outbound internet access. Optional repair command after at
least one sign-in:

```bash
npm run seed:senders
```

It creates only missing senders for each existing user, is safe to repeat, and
prints the terminal Ethereal credentials. Sender rows with no owner are legacy
shared senders and are used only as a fallback when a user owns none.

### 4. Start Redis (BullMQ mode only)

Skip this in local mode. For BullMQ mode:

```bash
docker run -d --name reachinbox-redis -p 6379:6379 \
  redis:7-alpine redis-server --appendonly yes --appendfsync everysec \
  --maxmemory-policy noeviction
```

Or `docker compose up -d redis` from the repo root. AOF and `noeviction` are
required so queued jobs survive a Redis restart.

### 5. Run the API and worker

Local mode runs the delivery worker inside the API and needs one process:

```bash
QUEUE_DRIVER=local MAIL_TRANSPORT=local npm run dev
```

BullMQ mode can also run the worker inside the API in development, which is
what the one-command bootstrap does:

```bash
QUEUE_DRIVER=bullmq MAIL_TRANSPORT=ethereal npm run dev
```

To mirror production and run delivery in a separate process, disable the
embedded worker for the API and start the standalone consumer:

```bash
EMBED_WORKER=false npm run dev   # HTTP API (PowerShell: $env:EMBED_WORKER='false')
npm run worker                   # BullMQ consumer
```

Production build:

```bash
npm run build
npm start                        # API (EMBED_WORKER defaults off)
npm run start:worker             # worker
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode; production enables secure cookies |
| `PORT` | `4000` | API port |
| `FRONTEND_URL` | `http://localhost:3000` | Exact allowed CORS origin and OAuth redirect target; must be HTTPS in production |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | `file:./dev.db` in the example | SQLite file or PostgreSQL connection string |
| `QUEUE_DRIVER` | `local` in development, `bullmq` in production | Local database poller or BullMQ delayed jobs |
| `MAIL_TRANSPORT` | `local` in development, `ethereal` in production | `.eml` outbox or Ethereal SMTP |
| `LOCAL_OUTBOX_DIR` | `.mail-outbox` | Local `.eml` output directory |
| `REDIS_URL` | empty in local mode | Required when `QUEUE_DRIVER=bullmq` |
| `GOOGLE_CLIENT_ID` | empty | Google OAuth client ID; required in production |
| `GOOGLE_CLIENT_SECRET` | empty | Google OAuth client secret; required in production |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/api/auth/google/callback` | Must match Google Console exactly; must be HTTPS in production |
| `DEV_AUTH_ENABLED` | `false` | Local-only demo login; must be false when `NODE_ENV=production` |
| `DEV_AUTH_EMAIL` | `dev@reachinbox.test` | Email for the local demo user |
| `DEV_AUTH_NAME` | `Local Demo` | Display name for the local demo user |
| `JWT_SECRET` | required | Signs the 7-day session cookie; at least 32 characters and not a documented placeholder in production |
| `COOKIE_SAMESITE` | auto | `lax`/`strict`/`none`; production defaults to `none` |
| `EMBED_WORKER` | `true` in development, `false` otherwise | Attach the delivery worker to the API process; local mode needs it, and BullMQ production uses a separate worker |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Per-sender gap floor used by the planner and Redis reservation |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Hard per-sender hourly cap |
| `RATE_WINDOW_MS` | `3600000` | Fixed window size; use `60000` for demos |
| `CLAIM_TTL_MS` | `120000` | Stale `PROCESSING` claim recovery window |
| `SENDER_COUNT` | `3` | Ethereal senders provisioned per user |

Set `RATE_WINDOW_MS=60000` and `MAX_EMAILS_PER_HOUR_PER_SENDER=3` to demonstrate
window rollover in one minute.

## API

All email routes require the session cookie. Errors use
`{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service banner |
| `GET` | `/health` or `/api/health` | 200 when the configured database responds; in BullMQ mode Redis must also respond |
| `GET` | `/api/auth/google` | Returns `{ authUrl }` for the OAuth redirect flow |
| `GET` | `/api/auth/google/callback` | OAuth callback; sets the session cookie |
| `GET` | `/api/auth/callback` | Callback alias |
| `POST` | `/api/auth/google` | Google Identity Services `{ credential }` flow |
| `POST` | `/api/auth/dev-login` | Local-only demo session; 404 in production |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/logout` | Clears the session cookie |
| `POST` | `/api/schedule` | Schedule a batch (canonical) |
| `POST` | `/api/emails/schedule` | Frontend-compatible alias |
| `GET` | `/api/emails/scheduled?page=1&limit=20` | Scheduled/processing rows |
| `GET` | `/api/emails/sent?page=1&limit=20` | SENT/FAILED rows |
| `GET` | `/api/emails/stats` | Counts by status |
| `DELETE` | `/api/emails/:id` | Cancel a scheduled email and remove its job |
| `DELETE` | `/api/emails/scheduled` | Delete all queued scheduled emails for the user |
| `POST` | `/api/admin/reconcile` | Authenticated manual DB -> Redis repair (demo only, no admin role) |

Schedule body (backend and dashboard field names are both accepted):

```json
{
  "subject": "Hello",
  "body": "<p>Body</p>",
  "recipients": ["a@example.com", "b@example.com"],
  "startTime": "2026-10-24T10:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 100,
  "idempotencyKey": "batch_1719234567890_ab12cd"
}
```

Aliases: `startAt`, `delayBetweenEmailsMs`, `delaySeconds`, `maxEmailsPerHour`.
`idempotencyKey` is optional but recommended; reuse the same key only when
retrying the same submission. A start time at or before the current time is
clamped to now, so the batch sends immediately.
The response is `202` with `batchId`, `total`, `acceptedCount`, `firstSendAt`,
`lastSendAt`, `delayMs`, and `hourlyLimit`. Over-limit recipients are assigned
later windows, never rejected.

## Google OAuth

In Google Cloud Console create an OAuth 2.0 Web client and add the exact
callback URI, for example:

- Docker proxy: `http://localhost:3000/api/auth/google/callback`
- Direct local: `http://localhost:4000/api/auth/google/callback`
- Vercel proxied: `https://your-frontend.vercel.app/api/auth/google/callback`

When the frontend proxies `/api` to the backend, use the frontend origin in
`GOOGLE_CALLBACK_URL` so the session cookie stays first-party.

Email/password is intentionally disabled. Google is the production identity
provider. `POST /api/auth/dev-login` exists only for local Docker/demo use and
returns 404 when `DEV_AUTH_ENABLED=false` or `NODE_ENV=production`.

## Verification and tests

```bash
npm run typecheck
npm test
npm run build
```

`test/planner.test.ts` and `test/window.test.ts` cover the pure planner, window
rollover, per-sender limits, and overflow behavior. `test/hourly.test.ts`
verifies rate-limit keys are scoped per batch, sender, and window.
`test/processEmail.test.ts` covers atomic-claim conflicts, per-sender delay
deferral, batch/hourly deferral, deterministic `Message-ID`, permanent
failures, last-attempt failures, and transient retries. `test/senders.test.ts`
covers local and Ethereal per-user provisioning, target-count
short-circuiting, concurrent deduplication, and owned-versus-legacy selection.
`test/localPacer.test.ts` covers local delay and hourly enforcement.
`test/load1000.test.ts` plans 1,000 recipients and verifies bulk enqueue chunks
of 500 jobs (32 tests total).

The zero-dependency end-to-end check lives at the repository root:

```bash
npm run test:local
```

It starts the API on a free port with a temporary SQLite database and outbox,
then verifies health, demo login, delivery, `.eml` contents, single and bulk
cancellation, restart recovery of an interrupted row, and stats.

For a real Redis enqueue benchmark that does not send SMTP mail (BullMQ mode
only):

```bash
npm run test:load -- 1000
```

It uses a throwaway queue and removes it after reporting planning/enqueue time,
planned windows, and job counts. It requires a reachable Redis.

Production-shaped end-to-end send/restart tests require Postgres and Redis:

1. Schedule 20 emails 2 minutes ahead.
2. Stop API/worker, restart both; rows remain scheduled and the worker logs
   `reconcile complete`.
3. Confirm each email appears exactly once in the Ethereal inbox.
4. `redis-cli FLUSHALL`, restart the worker; pending jobs are restored.
5. With `MAX=3` and `RATE_WINDOW_MS=60000`, schedule 10; 3 send in the first
   window and 7 are re-delayed, none failed.

Local restart behavior is simpler: the embedded worker releases interrupted
`PROCESSING` rows at startup and continues from the SQLite rows. The automated
local check covers this.

## Deployment

### Full stack with Docker

The root `docker-compose.yml` builds the backend once and reuses the runtime
image for the API and worker, with a separate `migrator` target for
`prisma migrate deploy`.

```bash
NODE_ENV=production \
DEV_AUTH_ENABLED=false \
JWT_SECRET='<32+ character secret>' \
FRONTEND_URL=https://scheduler.example.com \
GOOGLE_CLIENT_ID='<google client id>' \
GOOGLE_CLIENT_SECRET='<google client secret>' \
GOOGLE_CALLBACK_URL=https://scheduler.example.com/api/auth/google/callback \
DATABASE_URL='postgresql://...' \
REDIS_URL='rediss://...' \
docker compose up -d --build
```

The frontend container proxies `/api/*` to `http://api:4000`, so the browser and
session cookie are same-origin. Terminate TLS in front of the frontend and keep
Postgres/Redis private. See the root README for details.

### API and worker on Render

The root `render.yaml` is a Render Blueprint that creates the API web service,
the background worker, Postgres 16, a Key Value instance with `noeviction` and
journal-snapshot persistence, and a shared runtime environment group.

- API: root directory `backend`, build `npm ci --include=dev && npm run build`,
  pre-deploy `npx prisma migrate deploy`, start `npm run start`, health check
  `/health`.
- Worker: the same root and build, the same pre-deploy migration, and
  `npm run start:worker`. It must run as a paid Render background worker.
- Both need the same `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and pacing
  settings. The worker does not need Google OAuth or `FRONTEND_URL`.
- Set `QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal` on both services.
  SQLite, the embedded local worker, and the `.eml` outbox are local-only.
- Keep `EMBED_WORKER=false` in production so only the dedicated worker consumes
  the queue.
- Use paid instance types. Free web services sleep, block SMTP ports 465/587,
  and the free Key Value and Postgres plans are not durable.
- The API process refuses to start in production without HTTPS `FRONTEND_URL`
  and `GOOGLE_CALLBACK_URL`, Google credentials, a 32+ character
  non-placeholder `JWT_SECRET`,
  and `DEV_AUTH_ENABLED=false`.

Full settings, verification steps, and troubleshooting are in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md).

### Frontend on Vercel (recommended same-origin proxy)

Deploy the frontend as its own Vercel project (root directory `frontend`) and
point it at the Render API:

```text
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_DEV_AUTH_ENABLED=false
API_PROXY_TARGET=https://your-render-api.onrender.com
```

The Next.js rewrite proxies `/api/*` to Render, keeping the session cookie
first-party and avoiding browser third-party-cookie blocking. Set the backend's
`GOOGLE_CALLBACK_URL` to the frontend origin plus
`/api/auth/google/callback`, and `FRONTEND_URL` to the frontend origin.

If you call the API directly across different sites instead, set
`COOKIE_SAMESITE=none` and expect some browsers to block the cookie. Custom
domains on the same registrable domain (for example `app.example.com` and
`api.example.com`) avoid that problem.

## Operational notes / trade-offs

- `/api/admin/reconcile` requires authentication but has no admin-role check.
  This is accepted for the demo; add an admin role or secret before production.
- Redis must use `noeviction`. A Redis with `volatile-lru` can evict BullMQ
  delayed jobs.
- Live Google OAuth and Ethereal delivery are not covered by automated tests.
- Fixed hourly windows can allow a boundary burst of up to 2x the cap.
- Failed sends consume rate-limit slots; there is no refund.
- `GET /health` is a dependency check. In BullMQ mode it returns 503 until both
  Postgres and Redis are reachable; local mode depends only on SQLite.
- Local mode assumes one API process per database file and releases all
  `PROCESSING` rows at startup. Do not run two local workers against the same
  SQLite file.
- Local `.eml` files are not delivered mail and have no preview URL. They are
  git-ignored and safe to delete after inspection.
- List endpoints use offset pagination and the dashboard polls every 5 seconds.
- Ethereal is a sandbox: delivery is not real and no provider throttling is
  exercised. `previewUrl` links to the Ethereal message.
- Planning is serialized per user with a Postgres advisory lock, so different
  users plan in parallel; the Redis gate remains the final cross-worker
  safeguard.
- Sender credentials are per user but stored in plaintext, and sender
  provisioning needs internet access on first sign-in. A failed provisioning
  attempt is retried on the next schedule or by `seed:senders`.
