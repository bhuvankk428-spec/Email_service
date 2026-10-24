# ReachInbox Email Scheduler

A full-stack email scheduling service and dashboard, built for the ReachInbox.ai (Outbox Labs) Software Development Intern assignment. The API accepts batches of email-send requests, stores one durable record per recipient, schedules each send with BullMQ delayed jobs (no cron anywhere), and delivers through Ethereal SMTP. A Next.js dashboard lets a signed-in user compose batches and track what is scheduled and what has been sent.

The repository runs in two modes that share one codebase:

- **Local mode (default):** SQLite, a database-polling worker embedded in the API process, and a local `.eml` outbox. It needs only Node.js, with no Docker, Redis, PostgreSQL, or SMTP account. Messages are written to disk, not sent over SMTP.
- **BullMQ mode (production-shaped):** PostgreSQL, Redis, a separate BullMQ worker, and Ethereal SMTP. This is the architecture the assignment asks for, and it is what the Docker Compose stack and the Render Blueprint use.

The Next.js dashboard is identical in both modes and deploys to Vercel.

- **Live demo:** <https://emailserviceoutlab.vercel.app/>
- **Demo video:** <https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID>

## Contents

- [Features](#features)
- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API](#api)
- [Tests](#tests)
- [Deployment](#deployment)
- [Requirement checklist](#requirement-checklist)
- [Known limitations](#known-limitations)
- [Assumptions and trade-offs](#assumptions-and-trade-offs)
- [Further documentation](#further-documentation)

## Features

### Backend

- TypeScript and Express API with Zod request validation, Helmet, Pino logging, and centralized error responses.
- Prisma with SQLite for local mode and PostgreSQL for BullMQ mode. The engine, queue driver, and mail transport are chosen from environment variables.
- One database row per recipient, written in a single transaction per batch.
- One BullMQ delayed job per email in production, using the email row ID as the job ID.
- A planner that assigns an exact send time to every recipient from the start time, minimum gap, hourly allowance, and the user's sender pool.
- Per-user sender pools, created on first sign-in. Local senders use the `outbox.local` domain; hosted senders are Ethereal accounts.
- Redis Lua reservation for per-sender pacing and hourly limits, shared across worker processes. Local mode uses an equivalent in-process pacer.
- Configurable worker concurrency, retry with exponential backoff, and permanent-failure handling.
- Over-limit jobs are moved into a later window. They are never failed or dropped.
- Atomic row claiming (`SCHEDULED` to `PROCESSING`) and a deterministic `Message-ID`.
- Optional per-user `idempotencyKey` so a retried request returns the original batch.
- Database-to-queue reconciliation on worker startup, and release of stale processing claims.
- Chunked inserts and bulk enqueueing so 1,000+ recipients do not block the API response.
- Google OAuth, signed session cookies, user-scoped email endpoints, and cancellation.
- A local-only demo login for development and Docker, which is always rejected when `NODE_ENV=production`.
- A `/health` endpoint that checks the database and, in BullMQ mode, Redis.

### Frontend

- Next.js, React, TypeScript, and Tailwind CSS.
- Google sign-in and sign-out, with name, email, and avatar in the header.
- Scheduled and Sent tabs with counts, search, five-second polling, loading skeletons, and empty states.
- Compose view with subject, body, recipient chips, CSV/text lead upload with detected address count, start time (including Now), delay between emails, and hourly limit.
- Scheduled and Sent tables showing recipient, subject, scheduled or sent time, and status.
- Email detail view with a preview for scheduled messages and an Ethereal preview link for delivered ones.
- Cancel a single scheduled email, or clear the whole scheduled queue.
- Toast and error feedback for failed requests.
- Typed API contracts and reusable components.

## Stack

| Layer | Local mode (default) | BullMQ mode |
| --- | --- | --- |
| Dashboard | Next.js, React, TypeScript, Tailwind CSS | Same |
| API | Express, TypeScript, Zod, Helmet, Pino | Same |
| Queue | In-process database poller | BullMQ + Redis 7 (AOF, `noeviction`) |
| Database | SQLite via Prisma | PostgreSQL via Prisma |
| Delivery | Local `.eml` outbox | Nodemailer + Ethereal SMTP |
| Worker | Embedded in the API process | Separate worker process |
| Hosting | Your machine | Vercel (dashboard) + Render (API, worker, Postgres, Key Value) |
| Auth | Google OAuth or local demo login | Google OAuth only |

## Repository layout

```text
.
|- backend/
|  |- prisma/                  PostgreSQL schema and migrations, SQLite schema
|  |- generated/               Generated SQLite Prisma client (git-ignored)
|  |- scripts/                 Prisma client generation, sender repair, load test
|  |- src/
|  |  |- config/               Environment validation and mode selection
|  |  |- lib/                  Prisma client selection, Redis, windows, logging
|  |  |- middleware/           Auth and error handling
|  |  |- queue/                Driver facade, BullMQ runtime, local worker and pacer
|  |  |- ratelimit/            Redis hourly counter for BullMQ mode
|  |  |- routes/               Auth, schedule, emails, health, admin
|  |  |- services/             Planner, mail transport, job processor, senders
|  |  |- app.ts                Express app
|  |  |- server.ts             API process with optional embedded worker
|  |  |- worker.ts             Standalone BullMQ worker process
|  |- test/                    Planner, pacer, processor, sender, and load tests
|  |- README.md
|- frontend/
|  |- src/app/                 App router pages and global styles
|  |- src/components/          Auth, layout, list, detail, compose, and uploader
|  |- src/hooks/               Session and email data hooks
|  |- src/services/            API service wrappers
|  |- src/lib/                 HTTP client and lead parser
|  |- src/types/api.ts         Frontend API contract
|  |- README.md
|- scripts/dev.mjs             One-command setup and local process runner
|- scripts/smoke-local.mjs     Local end-to-end check
|- docker-compose.yml          Postgres, Redis, API, worker, frontend
|- render.yaml                 Render Blueprint (API, worker, Postgres, Key Value)
|- DEPLOYMENT.md               Vercel + Render runbook
|- DOCUMENTATION.md            Detailed architecture, schema, and security notes
|- HOW_TO_RUN.md               Local runbook, demo checklist, troubleshooting
```

## Architecture

### Request flow

```text
POST /api/schedule
  -> validate input, normalize and deduplicate recipients
  -> open a database transaction, take an advisory lock (PostgreSQL only)
  -> assign a send time to every recipient
  -> insert the batch and its email rows
  -> commit, then enqueue one delayed BullMQ job per row (BullMQ mode)
  -> respond 202 with the batch summary

BullMQ worker
  -> reconcile scheduled rows that have no job
  -> claim a row atomically (SCHEDULED -> PROCESSING)
  -> reserve a pacing slot and hourly capacity in Redis
  -> send through Ethereal with a deterministic Message-ID
  -> store SENT with the preview URL, or reschedule / fail

Local worker (inside the API process)
  -> poll every 400 ms for SCHEDULED rows whose time has arrived
  -> ask the in-process pacer which senders may send now
  -> claim a row atomically (SCHEDULED -> PROCESSING)
  -> write the message to the local outbox
  -> store SENT with no preview URL, or reschedule / fail
```

BullMQ delayed jobs are the only timer in BullMQ mode. Local mode reads `scheduledAt` straight from the database, and the enqueue call is a no-op. Neither mode uses cron, `node-cron`, `agenda`, or any timer that dispatches mail at a planned time.

### Restart behavior

The database is authoritative in both modes. A job is a timer that can be recreated, not the record of what must happen.

- **BullMQ mode:** Redis runs with AOF and `noeviction`, so delayed jobs survive a Redis restart. On worker startup, the reconciler scans scheduled rows and re-adds any job that is missing, using the existing email ID as the job ID. Because BullMQ rejects a duplicate job ID, this cannot create duplicates.
- **Local mode:** there is no queue to rebuild. At startup, every `PROCESSING` row is released back to `SCHEDULED`, since local mode assumes a single process. An interrupted row is retried and its outbox file is rewritten.

A row is claimed with a conditional update. A competing worker gets zero rows and backs off. If a worker dies mid-send, another worker may reclaim the row only after `CLAIM_TTL_MS` and after checking its status again.

### Delivery guarantee

Delivery over SMTP is at-least-once, not exactly-once. If a process dies after the SMTP server accepts a message but before the database records it, the retry can send the message again. The stable `Message-ID` (`<emailId@reachinbox.local>`) makes such a retry recognizable to the receiver, but it cannot force every mail system to deduplicate.

### Rate limiting and concurrency

Two layers cooperate.

1. **Planning.** When a batch is submitted, the planner walks each sender's timeline and assigns timestamps using the configured minimum gap and hourly allowance. Recipients that do not fit in the current window are placed in the next one, so most jobs are already at a sensible time before a worker sees them.
2. **Sending.** Before each send, the worker runs one Redis Lua script that atomically checks and reserves three things: a per-sender delay slot, a per-batch per-sender hourly slot, and a sender-wide hourly slot. Batch limits come from the request, clamped by the server. The sender-wide limit comes from `MAX_EMAILS_PER_HOUR_PER_SENDER`. Because the script runs inside Redis, the limits hold across processes and hosts. A denied job is written back as `SCHEDULED` and moved to the required retry time or the next window with `job.moveToDelayed`. It is never failed or removed. Local mode applies the same rules with `LocalPacer`, an in-process table hydrated from the last 24 hours of sent rows.

`WORKER_CONCURRENCY` sets how many jobs one worker processes at once. The per-sender reservation provides the gap between sends, so no global BullMQ limiter is used and different senders can send in parallel. `MIN_DELAY_BETWEEN_EMAILS_MS` is the floor and `MAX_EMAILS_PER_HOUR_PER_SENDER` is the ceiling, both set from the environment.

Windows are fixed, not sliding. A batch that straddles a boundary can briefly send up to twice the cap, and failed sends keep their reserved slot instead of refunding it. This keeps the counters simple and cheap.

With three senders in a user's pool and a cap of 200 per sender, that user's first window can deliver up to 600 messages. The remaining 400 of a 1,000-recipient batch are assigned to the next window. That is the limit working as designed, not a stalled queue. Capacity scales with the number of senders the user owns and does not depend on other users' pools.

### Large batches

A submission of 1,000 or more recipients is inserted in chunks and enqueued with `addBulk`, and the API responds without waiting for delivery. In PostgreSQL, a per-user advisory lock serializes that user's concurrent planners so two requests cannot claim the same capacity, while different users plan in parallel. SQLite serializes writes itself.

If the queue write fails after the database commit, the API still answers `202` with a warning, and the reconciler restores the missing jobs on the next worker start.

Example: 1,000 emails, 3 senders in the user's pool, a 2-second gap, and 100 emails per hour per sender gives 300 sends per hour, so the batch finishes in about four hours and no message is discarded.

### Retry-safe submissions

`POST /api/schedule` accepts an optional `idempotencyKey`, unique per user. Submitting the same key again returns the original batch with `idempotentReplay: true`. Concurrent retries race on a unique database index, and the loser returns the winner's batch. This covers a client retrying after a lost response.

## Getting started

### Prerequisites

- Node.js 20 or newer and npm
- Internet access for the first dependency install
- Docker Desktop, only for the PostgreSQL/Redis or Compose paths

### Local mode: one command

From the repository root:

```bash
npm run dev
```

The first run takes roughly 2 to 5 minutes. It creates the local env files, installs dependencies, generates the PostgreSQL and SQLite Prisma clients, creates `backend/prisma/dev.db`, and starts the API (with its embedded worker) and the dashboard. Later runs start in seconds.

Open <http://localhost:3000> and click **Continue in local demo mode**. Local senders use synthetic `@outbox.local` addresses, so nothing needs internet access after installation. Each delivery is written to `backend/.mail-outbox/<email-id>.eml`, which any mail client can open. The dashboard shows no preview link for local messages.

| Service | Address |
| --- | --- |
| Dashboard | <http://localhost:3000> |
| API | <http://localhost:4000> |
| API health | <http://localhost:4000/health> |
| Local database | `backend/prisma/dev.db` |
| Local outbox | `backend/.mail-outbox/*.eml` |

Press `Ctrl+C` to stop both processes. `npm start` is an alias for `npm run dev`, and `npm run setup` prepares everything without starting the apps. See [HOW_TO_RUN.md](HOW_TO_RUN.md) for the demo checklist and troubleshooting.

### BullMQ mode with Docker

```bash
docker compose up --build
```

Compose starts PostgreSQL, Redis, a one-shot migration container, the API, a separate BullMQ worker, and the frontend. It forces `QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal`, needs no env file, and enables the demo login so you can sign in immediately. The API container needs outbound internet access to create Ethereal accounts.

The frontend container proxies `/api` to the API, so the session cookie is first-party and no CORS setup is needed. Put overrides such as Google credentials or rate limits in a root `.env` file and run `docker compose up -d`.

Stop with `docker compose down`. Avoid `down -v` unless you want to delete the database and Redis volumes. Do not run the local bootstrap and the Docker stack at the same time, since both use ports 3000, 4000, 5432, and 6379.

### BullMQ mode without Docker for the app

To run the production-shaped stack from `npm run dev`, set these in `backend/.env`:

```text
DATABASE_URL=postgresql://...
QUEUE_DRIVER=bullmq
MAIL_TRANSPORT=ethereal
REDIS_URL=redis://...
```

Then run `npm run dev` again. When the database and Redis hosts point at localhost, the bootstrap starts PostgreSQL and Redis in Docker for you.

### Ethereal setup

There is nothing to configure by hand. On a user's first sign-in, the API calls Nodemailer's test-account API `SENDER_COUNT` times and stores the generated SMTP credentials in the `Sender` table with that user's ID. New batches are planned against that user's senders only. The first schedule for a new user waits if provisioning is still running. Delivered rows store a `previewUrl` that opens the message in the Ethereal inbox, and the Sent tab links to it.

`npm run seed:senders` (run from `backend`) is a repair command, not part of setup. It provisions missing senders for every existing user and is safe to repeat. With Docker, use `docker compose run --rm migrate npm run seed:senders`.

Older sender rows with no owner remain as a fallback for users who have no owned senders.

### Google OAuth

Create an OAuth 2.0 Web application in Google Cloud Console and register the callback URL that matches how you run the app:

```text
Docker or proxied dashboard:  http://localhost:3000/api/auth/google/callback
Direct local API:             http://localhost:4000/api/auth/google/callback
Vercel frontend proxy:        https://your-frontend.vercel.app/api/auth/google/callback
```

For `npm run dev`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `backend/.env`. For Docker Compose, put the same values in a root `.env`. `FRONTEND_URL` must be the exact dashboard origin with no trailing slash, because it drives CORS and post-login redirects. The URL you browse to, the URL registered with Google, and `GOOGLE_CALLBACK_URL` must all match.

## Environment variables

Each app ships an `.env.example` with placeholder values. Never commit populated `.env` files.

### Backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode. Production enables secure cookies. |
| `PORT` | `4000` | API port. |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed dashboard origin. Must be HTTPS in production. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `DATABASE_URL` | `file:./dev.db` (example) | SQLite file for local mode, or a PostgreSQL connection string. |
| `QUEUE_DRIVER` | `local` in development, `bullmq` in production | `local` polls the database in-process; `bullmq` uses Redis delayed jobs. |
| `MAIL_TRANSPORT` | `local` in development, `ethereal` in production | `local` writes `.eml` files; `ethereal` sends test SMTP mail. |
| `LOCAL_OUTBOX_DIR` | `.mail-outbox` | Local `.eml` output directory, relative to `backend`. |
| `REDIS_URL` | empty | Required only when `QUEUE_DRIVER=bullmq`. |
| `JWT_SECRET` | required | Signs the seven-day session cookie. At least 32 characters, and not a placeholder, in production. |
| `COOKIE_SAMESITE` | auto | `lax`, `strict`, or `none`. Production defaults to `none`. |
| `GOOGLE_CLIENT_ID` | empty | Google OAuth client ID. Required in production. |
| `GOOGLE_CLIENT_SECRET` | empty | Google OAuth client secret. Required in production. |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/api/auth/google/callback` | Must match Google Console. HTTPS in production. |
| `DEV_AUTH_ENABLED` | `false` (the example enables it) | Local demo login. Always rejected in production. |
| `DEV_AUTH_EMAIL` | `dev@reachinbox.test` | Demo user email. |
| `DEV_AUTH_NAME` | `Local Demo` | Demo user name. |
| `EMBED_WORKER` | `true` in development, `false` otherwise | Run the worker inside the API process. Local mode needs it on; production uses a separate worker. |
| `WORKER_CONCURRENCY` | `5` | Jobs processed in parallel per worker. |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Server floor for the per-sender gap between sends. |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Hourly cap for each sender. |
| `RATE_WINDOW_MS` | `3600000` | Rate-limit window length. |
| `CLAIM_TTL_MS` | `120000` | Age after which a processing claim can be reclaimed. |
| `SENDER_COUNT` | `3` | Senders provisioned per user. |

For Supabase or another hosted PostgreSQL provider, run migrations over the session pooler or direct connection on port `5432`. The transaction pooler on port `6543` does not support the migration behavior Prisma needs. SQLite is for local runs only, and hosts with ephemeral disks must use PostgreSQL.

To see window rollover quickly, set `RATE_WINDOW_MS=60000` and `MAX_EMAILS_PER_HOUR_PER_SENDER=3`, then restore your normal values.

### Frontend

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api` | API base URL seen by the browser. |
| `NEXT_PUBLIC_DEV_AUTH_ENABLED` | `false` (the example enables it) | Shows the local demo login button. |
| `API_PROXY_TARGET` | empty | Server-side rewrite target for same-origin `/api` calls. |

## API

Email endpoints require the session cookie. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | 200 when the database and, in BullMQ mode, Redis respond. |
| `GET` | `/api/auth/google` | Returns the Google authorization URL. |
| `GET` | `/api/auth/google/callback` | OAuth callback. Sets the session cookie. |
| `POST` | `/api/auth/google` | Google Identity Services credential exchange. |
| `POST` | `/api/auth/dev-login` | Local-only demo session. |
| `GET` | `/api/auth/me` | Current user. |
| `POST` | `/api/auth/logout` | Clears the session cookie. |
| `POST` | `/api/schedule` | Schedule a batch (canonical route). |
| `POST` | `/api/emails/schedule` | Alias used by the dashboard. |
| `GET` | `/api/emails/scheduled` | Scheduled and processing rows, paginated. |
| `GET` | `/api/emails/sent` | Sent and failed rows, paginated. |
| `GET` | `/api/emails/stats` | Counts by status. |
| `DELETE` | `/api/emails/:id` | Cancel a scheduled email and remove its job. |
| `DELETE` | `/api/emails/scheduled` | Cancel every queued scheduled email for the user. |
| `POST` | `/api/admin/reconcile` | Authenticated database-to-queue repair. |

### Example request

```json
{
  "subject": "Hello",
  "body": "<p>Body</p>",
  "recipients": ["a@example.com", "b@example.com"],
  "startAt": "2026-10-26T10:00:00.000Z",
  "delayBetweenEmailsMs": 2000,
  "maxEmailsPerHour": 100,
  "idempotencyKey": "batch_1719234567890_ab12cd"
}
```

`startTime`, `delayMs`, `delaySeconds`, `hourlyLimit`, and `maxEmailsPerHour` are accepted as aliases. A `startAt` at or before the current time is clamped to now, so immediate sends are accepted, while later recipients still follow the delay and hourly cap.

The response is `202` with `batchId`, `total`, `acceptedCount`, `firstSendAt`, `lastSendAt`, `delayMs`, and `hourlyLimit`. The returned pacing values are the effective values after server-side clamping. Recipients beyond the current window are scheduled later, not rejected.

## Tests

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

The backend suite has 32 tests. They cover timestamp planning, window rollover, per-sender overflow, hourly key scoping, a 1,000-email plan, 500-job bulk-enqueue chunks, atomic claim conflicts, delay and hourly deferral, deterministic message IDs, permanent failures, retry handling, per-user sender provisioning (local and Ethereal), concurrent provisioning, owned versus legacy sender selection, and the local pacer.

The local end-to-end check needs no external services. It creates a temporary SQLite database and outbox, starts the API on a free port, signs in, schedules and delivers messages, cancels single and bulk rows, simulates an interrupted `PROCESSING` row across a restart, and verifies stats. It cleans up after itself and does not touch ports 3000 or 4000 or your real database:

```bash
npm run test:local
```

To benchmark enqueueing 1,000 jobs against a real Redis (requires `QUEUE_DRIVER=bullmq`):

```bash
cd backend
npm run test:load -- 1000
```

This uses a throwaway queue and sends no SMTP mail. It reports planning time, enqueue time, planned windows, and job counts, then removes the queue.

### Manual restart test

1. Schedule several emails a few minutes ahead.
2. Stop the API and worker, then start them again.
3. Confirm the rows are still scheduled and each email sends once at its planned time.
4. In a disposable environment, empty Redis and restart the worker. The reconciler restores the pending jobs from PostgreSQL.

## Deployment

The supported production layout is a Vercel dashboard, with the Express API, BullMQ worker, PostgreSQL, and a Redis-compatible Key Value store on Render. [DEPLOYMENT.md](DEPLOYMENT.md) has the full setup, verification, and troubleshooting steps.

### Vercel (frontend)

- Import the repository with root directory `frontend` and framework Next.js.
- Set `NEXT_PUBLIC_API_BASE_URL=/api`, `NEXT_PUBLIC_DEV_AUTH_ENABLED=false`, and `API_PROXY_TARGET=https://<render-api-host>`.
- Register `https://<frontend>/api/auth/google/callback` in Google Cloud Console.
- The `/api/*` rewrite keeps the session cookie first-party. Without it, browsers can block cross-site cookies.

### Render (backend)

- Apply the root `render.yaml` Blueprint. It creates Postgres 16, a Key Value instance with `noeviction` and persistence, the API web service, the separate worker, and a shared environment group that sets `QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal`.
- Set `FRONTEND_URL=https://<frontend>` and `GOOGLE_CALLBACK_URL=https://<frontend>/api/auth/google/callback` when the Blueprint prompts, along with the Google client ID and secret.
- Both services run `prisma migrate deploy` before deploy. The API is health-checked at `/health`. The worker runs `npm run start:worker`.
- Keep `EMBED_WORKER=false` so the API never delivers mail.
- Use paid instance types. Free web services sleep, free instances block the SMTP ports Ethereal uses, and free Key Value and Postgres instances are not durable.
- In production the API refuses to start without HTTPS URLs, Google OAuth credentials, a strong `JWT_SECRET`, and `DEV_AUTH_ENABLED=false`.

Ethereal stays a test SMTP sandbox in this deployment. Messages are viewable through preview links but do not reach real inboxes.

### Docker on a single host

Provide production values and run:

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

Terminate TLS in front of the frontend and keep PostgreSQL and Redis off public interfaces. When using managed services, stop the local `postgres` and `redis` containers.

## Requirement checklist

### Backend

- [x] TypeScript, Express, BullMQ, Redis, PostgreSQL, and Ethereal SMTP (SQLite for local mode)
- [x] Scheduling API that stores recipients before enqueueing
- [x] Delayed BullMQ jobs in production and a database poller locally, with no cron
- [x] Multiple senders via Ethereal, in per-user pools
- [x] Restart persistence with database reconciliation
- [x] Idempotent submission, enqueueing, claiming, and message IDs
- [x] Configurable worker concurrency
- [x] Configurable minimum delay between sends
- [x] Hourly limit backed by Redis (shared across workers)
- [x] Over-limit jobs deferred to the next window, never dropped
- [x] Defined behavior for 1,000+ emails at the same time (chunked inserts, bulk enqueue, per-sender spreading)
- [x] Retry with backoff and permanent-failure handling
- [x] Google OAuth and user-scoped data access

### Frontend

- [x] Google login and logout, with name, email, and avatar in the header
- [x] Scheduled and Sent tabs with status labels
- [x] Compose view: subject, body, recipients, CSV/text upload, start time, delay, hourly limit
- [x] Detected address count after parsing an upload
- [x] Loading, empty, and error states
- [x] Email detail view, single cancellation, and bulk cancellation
- [x] Typed API responses and component props
- [x] Reusable toast, icon, and layout components
- [x] Dashboard layout and green theme following the supplied design

The compose form sends both the delay and the hourly limit. The API clamps them to the server minimum gap and per-sender cap, so a browser cannot weaken pacing. The hourly limit entered in the form applies to the batch, per sender. The server-wide `MAX_EMAILS_PER_HOUR_PER_SENDER` applies across all batches, and the lower value wins.

## Known limitations

- `/api/admin/reconcile` requires a session but not an admin role, and the dashboard does not expose it. I accepted this for the demo. It needs role checks before use in a multi-tenant deployment.
- Local mode assumes one API process per SQLite file. On startup it releases every `PROCESSING` row, so two local workers on the same database could send a row twice. Use BullMQ mode for multiple workers.
- Local messages are files in `backend/.mail-outbox` with no preview URL. They are not delivered email. The folder can be deleted after inspection, since the database remains the record of what was sent.
- The local worker polls every 400 ms, so delivery can lag the scheduled time by about half a second.
- SQLite is for local evaluation only. Render and other hosts with ephemeral disks must use PostgreSQL.
- In BullMQ mode, Redis must run with `--maxmemory-policy noeviction`. If another local Redis container uses `volatile-lru`, BullMQ warns and queued jobs may be evicted.
- The dashboard loads up to 100 rows per tab and has no pagination controls. The API accepts `page` and `limit`, so older rows are reachable through the API but not the current UI.
- The automated tests do not exercise live Google OAuth or Ethereal delivery, since both need external credentials. They do cover the planner, enqueue payloads, limiter deferral, and worker state transitions.

## Assumptions and trade-offs

- SMTP delivery is at-least-once. A deterministic `Message-ID` helps receivers spot duplicates, but true exactly-once delivery is not achievable over SMTP.
- Fixed hourly windows can allow a short burst of up to twice the cap at a boundary.
- A failed send consumes its reserved slot.
- Ethereal is a sandbox, so real provider throttling and inbox placement are not exercised.
- The API returns `202` after the database commit. A queue outage is repaired by reconciliation instead of being rolled back, because the database is the source of truth.
- The dashboard polls every five seconds. Scheduling itself is push-based through delayed jobs in production, and only the UI polls for fresh status. Local mode polls the database by design.
- `GET /health` returns 503 while a required dependency is down. In local mode it depends only on the SQLite file.

## Further documentation

- [HOW_TO_RUN.md](HOW_TO_RUN.md): local runbook, demo checklist, and troubleshooting.
- [DOCUMENTATION.md](DOCUMENTATION.md): architecture, API, schema, environment, security, and testing notes.
- [DEPLOYMENT.md](DEPLOYMENT.md): Vercel and Render deployment runbook.
- [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md): per-app reference.
