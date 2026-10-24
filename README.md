# ReachInbox Email Scheduler

A full-stack email scheduling service with two interchangeable runtime modes.
The default local mode needs only Node.js: it stores data in a SQLite file, runs
the delivery worker inside the API process, and writes every outgoing message to
a local `.eml` outbox instead of using SMTP. The production mode used by the
Render Blueprint stores data in PostgreSQL, runs a separate BullMQ worker backed
by Redis, and sends through Ethereal SMTP. The Next.js dashboard is the same in
both modes and deploys to Vercel.

Project documents:

- [DEPLOYMENT.md](DEPLOYMENT.md) is the Vercel frontend and Render backend
  production runbook.
- [DOCUMENTATION.md](DOCUMENTATION.md) covers architecture, features, the API
  reference, database schema, environment configuration, security, deployment,
  testing, and the work recorded during development.
- [HOW_TO_RUN.md](HOW_TO_RUN.md) is the local runbook, demo checklist, and
  troubleshooting guide.
- [backend/README.md](backend/README.md) and
  [frontend/README.md](frontend/README.md) describe each application.

## Stack

| Layer | Local mode (default) | Production mode |
| --- | --- | --- |
| Dashboard | Next.js 16, React, TypeScript, Tailwind CSS | Same |
| API | Express 4, TypeScript, Zod, Helmet, Pino | Same |
| Queue | In-process database poller | BullMQ + Redis 7 (AOF + `noeviction`) |
| Database | SQLite file via Prisma | PostgreSQL via Prisma |
| Delivery | Local `.eml` outbox | Nodemailer + Ethereal SMTP |
| Hosting | Your machine, no containers | Vercel dashboard + Render API/worker |
| Auth | Google OAuth 2.0 or local demo login | Google OAuth 2.0 only |

## Features

### Backend

- Runs with zero external services by default: no Docker, PostgreSQL, Redis,
  Supabase, or SMTP account is required for local use.
- Selects the database engine, queue driver, and mail transport from
  environment variables, so one codebase serves both local and hosted modes.
- Validates scheduling requests and writes one row per recipient in a single
  database transaction.
- Creates one BullMQ delayed job per email in production, using the email ID as
  the job ID; local mode polls the database for due rows instead.
- Plans an exact timestamp for each recipient from the start time (or from now
  for an immediate request), minimum send gap, and hourly allowance, spreading
  the batch across the user's senders.
- Gives each user their own sender pool, created automatically on first
  sign-in. Local senders use the `outbox.local` domain; hosted senders are
  Ethereal accounts. Legacy shared senders remain a fallback for existing data.
- Writes each local message to `backend/.mail-outbox/<email-id>.eml` and records
  it as `SENT` without contacting a mail server.
- Persists everything in the database, so Redis can be rebuilt at any time in
  production.
- Reconciles the queue from the database on worker startup and releases stale
  processing claims.
- Uses a Redis Lua reservation in production, and an equivalent in-process
  pacer locally, to enforce both a minimum per-sender gap and an hourly limit
  that combines the batch setting with the server-wide per-sender cap.
- Lets different senders deliver in parallel while keeping each sender within
  its own pacing and hourly limit.
- Moves over-limit jobs into a later window instead of failing or dropping
  them.
- Retries transient SMTP errors with exponential backoff and marks permanent
  failures as `FAILED`.
- Supports idempotent submissions, atomic row claiming, and a deterministic
  `Message-ID`.
- Ships with Google login, session cookies, user-scoped email endpoints, and
  cancellation.
- Includes a local-only demo login for development and Docker, permanently
  disabled in production.

### Frontend

- Google sign-in and sign-out, with name, email, and avatar in the header.
- Scheduled and Sent tabs with counts, polling, search, loading skeletons, and
  empty states.
- Compose view with recipient chips, CSV/text lead upload, subject, body, start
  time, delay between emails, and a per-sender hourly limit.
- Scheduled and Sent rows show recipient email, subject, scheduled or sent time,
  and status.
- Email detail view with previews for scheduled messages and Ethereal preview
  links for delivered messages.
- Cancel one scheduled email or delete the entire scheduled queue at once.
- Toast and error feedback for failed requests.

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
|  |  |- queue/                Driver facade, BullMQ runtime, local worker/pacer
|  |  |- ratelimit/            Redis hourly counter for BullMQ mode
|  |  |- routes/               Auth, schedule, emails, health, admin
|  |  |- services/             Planner, mail transport, job processor, senders
|  |  |- app.ts                Express app
|  |  |- server.ts             API process with optional embedded worker
|  |  |- worker.ts             Standalone BullMQ worker process
|  |- test/                    Planner, pacer, processor, sender, and load tests
|  |- README.md                Backend reference
|- frontend/
|  |- src/app/                 App router pages and global styles
|  |- src/components/          Auth, layout, list, detail, compose, and uploader
|  |- src/hooks/               Session and email data hooks
|  |- src/services/            API service wrappers
|  |- src/lib/                 HTTP client and lead parser
|  |- src/types/api.ts         Frontend API contract
|- scripts/dev.mjs             One-command setup and local process runner
|- scripts/smoke-local.mjs     Automated zero-dependency local end-to-end check
|- docker-compose.yml          Optional Postgres, Redis, API, worker, frontend
|- render.yaml                 Render Blueprint for the API, worker, Postgres, Key Value
|- frontend/vercel.json       Vercel project config for the dashboard
|- DEPLOYMENT.md               Vercel + Render production runbook
```

## Architecture

### Request flow

```text
POST /api/schedule
  -> validate input, normalize and deduplicate recipients
  -> open a database transaction and take an advisory lock (PostgreSQL only)
  -> assign a send time to every recipient
  -> insert the batch and its email rows
  -> commit, then enqueue one delayed BullMQ job per row (production)
  -> respond 202 with the batch summary

Production worker
  -> reconcile scheduled rows that have no job
  -> claim a row atomically (SCHEDULED -> PROCESSING)
  -> reserve an hourly slot for that sender in Redis
  -> send through Ethereal with a deterministic Message-ID
  -> store SENT with the preview URL, or reschedule / fail

Local worker (inside the API process)
  -> poll every 400 ms for SCHEDULED rows whose time has arrived
  -> ask the in-process pacer which senders may send now
  -> claim a row atomically (SCHEDULED -> PROCESSING)
  -> write the message to the local outbox
  -> store SENT with no preview URL, or reschedule / fail
```

Production uses BullMQ delayed jobs as its only timer. Local mode uses the
database poller; the enqueue call is a no-op there. Neither mode uses cron,
`node-cron`, `agenda`, or a timer that dispatches mail at a planned time.

### Restart behavior

The database is authoritative in both modes. A job is a timer that can be
recreated, not the record of what must happen. In production, the reconciler
scans scheduled emails on worker startup and re-adds any missing jobs with their
existing IDs, which makes the operation idempotent. Redis runs with AOF and
`noeviction` so delayed jobs survive a Redis restart as well.

In local mode there is no queue to rebuild. The embedded worker polls
`scheduledAt` directly. At startup it releases every `PROCESSING` row back to
`SCHEDULED`, because the local worker assumes a single process; a row
interrupted by a restart is retried and the outbox file is rewritten.

A row is sent at most once per claim. The worker updates the row from
`SCHEDULED` to `PROCESSING` with a conditional update; a competing worker gets
zero rows and reschedules its job. If a worker dies mid-send, another worker can
reclaim the row only after `CLAIM_TTL_MS` and after checking the status again.
The `Message-ID` is `<emailId@reachinbox.local>`, so a retry after an uncertain
SMTP handoff is recognizable to the receiver.

Delivery is at-least-once. SMTP cannot promise exactly-once when a process dies
between the server accepting a message and the database recording it; the stable
`Message-ID` is the mitigation.

### Rate limiting and concurrency

Two layers cooperate:

1. **Planning.** When a batch is submitted, the planner walks each sender's
   timeline and assigns timestamps using the configured minimum gap and hourly
   allowance. Recipients that do not fit in the current window are placed in the
   next one. This keeps most jobs at a sensible time before they ever reach a
   worker.
2. **Sending.** In production, before each send, the worker calls one Redis Lua
   script that checks and reserves a per-sender delay slot, a per-batch
   per-sender hourly slot, and a sender-wide hourly slot in a single atomic
   operation. Batch limits come from the request (clamped by the server); the
   sender-wide limit comes from `MAX_EMAILS_PER_HOUR_PER_SENDER`. Because the
   script runs inside Redis, the limits hold across processes and hosts. A
   denied job is written back as `SCHEDULED`, moved to the required retry time
   or next window with `job.moveToDelayed`, and retried; it is not failed or
   removed. Local mode applies the same rules with `LocalPacer`, an in-process
   reservation table hydrated from the last 24 hours of sent rows.

`WORKER_CONCURRENCY` controls how many jobs a worker may process at once. The
per-sender reservation provides the send gap, so a global BullMQ limiter is not
used and different senders can send in parallel. `MIN_DELAY_BETWEEN_EMAILS_MS`
is the floor and `MAX_EMAILS_PER_HOUR_PER_SENDER` is the ceiling. Both come from
the environment.

Windows are fixed rather than sliding. A batch that straddles a boundary can
briefly send up to twice the cap. Failed sends keep their reserved slots rather
than refunding them. Those choices keep the counters simple and cheap, which is
the right trade-off for this workload.

With three senders in a user's pool and a cap of 200 per sender, that user's
first window can deliver up to 600 messages. The next 400 of a 1,000-recipient
batch are assigned to the next window. That is the rate limit working as
designed, not a stalled queue. Capacity scales with the number of senders owned
by that user and is independent of other users' pools.

### Large batches

A submission of 1,000 or more recipients is inserted in chunks and enqueued
with `addBulk` in production; the API does not wait for delivery. A per-user
PostgreSQL advisory lock serializes that user's concurrent planners so two
requests cannot assign the same capacity; different users plan in parallel.
SQLite writes are serialized by the database, so local mode needs no advisory
lock. If a queue write fails after the database commit, the API responds `202`
with a warning; the reconciler restores the missing jobs on the next worker
start.

Example: 1,000 emails, 3 senders in that user's pool, a 2-second gap, and 100
emails per hour per sender gives 300 sends per hour for that user, so the batch
finishes in about four hours with no message discarded. The `test:load` command
reports the measured planning and enqueue times for a throwaway queue; delivery
time is dominated by the configured rate limits.

### Retry-safe submissions

`POST /api/schedule` accepts an optional `idempotencyKey`, unique per user. If
the same key is submitted again, the original batch is returned with
`idempotentReplay: true`. Concurrent retries race on a unique database index;
the loser returns the winner's batch. This protects against a client retrying a
request whose response was lost.

## Getting started

### Prerequisites

- Node.js 20 or newer
- Internet access for the first dependency install
- Docker Desktop only if you choose the optional PostgreSQL/Redis or Compose path

Nothing else is required. Local mode needs no Docker, PostgreSQL, Redis,
Supabase, Google account, or SMTP account.

### Quick start: one command

From the repository root:

```bash
npm run dev
```

The first run takes roughly 2-5 minutes and automatically creates the local env
files, installs dependencies, generates the PostgreSQL and SQLite Prisma
clients, creates `backend/prisma/dev.db`, and starts the API with its embedded
local worker plus the dashboard. Later runs skip completed steps and start in
seconds.

Open <http://localhost:3000> and click **Continue in local demo mode**. Local
senders use synthetic `@outbox.local` addresses, so sign-in and scheduling need
no internet after installation. Deliveries are written as `.eml` files under
`backend/.mail-outbox`; open one in any mail client to inspect the raw message.
The dashboard shows no preview link for local messages because there is no
hosted mailbox.

Press `Ctrl+C` to stop both processes. There are no background services to stop.

| Service | Address |
| --- | --- |
| Dashboard | <http://localhost:3000> |
| API | <http://localhost:4000> |
| API health | <http://localhost:4000/health> |
| Local database | `backend/prisma/dev.db` |
| Local outbox | `backend/.mail-outbox/*.eml` |

`npm start` is an alias, and `npm run setup` prepares everything without
starting the apps. See [HOW_TO_RUN.md](HOW_TO_RUN.md) for configuration,
commands, the demo checklist, and troubleshooting.

To run the production-shaped stack on your machine instead, set
`DATABASE_URL` to a PostgreSQL URL, `QUEUE_DRIVER=bullmq`,
`MAIL_TRANSPORT=ethereal`, and `REDIS_URL` in `backend/.env`, then run
`npm run dev` again. The bootstrap starts local PostgreSQL and Redis in Docker
when those hosts point at localhost. Production mode uses a separate worker and
sends through Ethereal, which needs outbound internet access.

### Docker-only quick start

Docker can run the entire production-shaped stack without Node.js on the host:

```bash
docker compose up --build
```

Open <http://localhost:3000>. Compose builds the API and dashboard, starts
PostgreSQL, Redis, and a one-shot migration container, then runs the API,
BullMQ worker, and frontend. It forces `QUEUE_DRIVER=bullmq` and
`MAIL_TRANSPORT=ethereal`, so it exercises the hosted architecture rather than
the local SQLite mode. It needs no env file; backend defaults include a local
demo `JWT_SECRET` and `DEV_AUTH_ENABLED=true`, so **Continue in local demo
mode** works immediately.
The backend rejects that endpoint when `NODE_ENV=production`. Ethereal senders
are created per user on first sign-in, so the API container needs outbound
internet access.

The frontend container proxies `/api` to the API container, so the session
cookie is first-party and no CORS setup is needed. Put overrides such as Google
credentials or rate limits in a root `.env` file, then run
`docker compose up -d`. Stop with `docker compose down`; avoid `down -v` unless
you also want to delete the database and Redis volumes.

Do not run the local bootstrap and the Docker stack at the same time, because
both use ports 3000, 4000, 5432, and 6379. These defaults are for local use
only; for a reachable deployment set `NODE_ENV=production`, a strong
`JWT_SECRET`, `DEV_AUTH_ENABLED=false`, and real OAuth credentials.

### SMTP and per-user senders

Local mode creates `SENDER_COUNT` synthetic senders whose host is `outbox.local`;
messages are written to disk, and no sender credentials are used. Switching to
`MAIL_TRANSPORT=ethereal` uses Nodemailer's test SMTP accounts instead.

No Ethereal account is needed. Each user owns a separate sender pool. On first
sign-in, the API calls Nodemailer's test account API `SENDER_COUNT` times,
stores the generated SMTP credentials in the `Sender` table with that user's ID,
and plans new batches against only that user's senders. Nothing SMTP-related
needs to be placed in the environment.

The first schedule for a new user waits for provisioning if it is still running.
Provisioning needs outbound internet access. `previewUrl` stored on delivered
rows opens the message in the Ethereal inbox; the dashboard links to it from the
Sent tab.

Legacy sender rows created by older versions have no owner (`userId` is null).
They remain available as a fallback for a user who has no owned senders, but new
schedules use owned senders whenever any exist.

`npm run seed:senders` is a repair command, not part of setup. It provisions
missing senders for every existing user, is safe to repeat, and prints the
per-user count. Run it from `backend` after at least one sign-in if you want to
pre-create senders or repair a partial provisioning run. With Docker, run
`docker compose run --rm migrate npm run seed:senders`.

### Google OAuth

Create an OAuth 2.0 Web application in Google Cloud Console and register the
callback URL that matches your setup:

```text
Docker or proxied dashboard:
http://localhost:3000/api/auth/google/callback

Direct local API:
http://localhost:4000/api/auth/google/callback

Vercel frontend proxy:
https://your-frontend.vercel.app/api/auth/google/callback
```

For local `npm run dev`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_CALLBACK_URL` in `backend/.env`. For Docker Compose, put the same values
in a root `.env`. `FRONTEND_URL` must be the exact dashboard origin, without a
trailing slash, because it is used for CORS and post-login redirects.

## Environment variables

### Backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode; production enables secure cookies |
| `PORT` | `4000` | API port |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed dashboard origin; must be HTTPS in production |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | `file:./dev.db` (example) | SQLite file for local mode, or a PostgreSQL connection string |
| `QUEUE_DRIVER` | `local` in development, `bullmq` in production | `local` polls the database in-process; `bullmq` uses Redis delayed jobs |
| `MAIL_TRANSPORT` | `local` in development, `ethereal` in production | `local` writes `.eml` files; `ethereal` sends test SMTP mail |
| `LOCAL_OUTBOX_DIR` | `.mail-outbox` | Directory for local `.eml` output, relative to `backend` |
| `REDIS_URL` | empty locally | Required only when `QUEUE_DRIVER=bullmq` |
| `JWT_SECRET` | required | Signs the seven-day session cookie; at least 32 characters and not a documented placeholder in production |
| `COOKIE_SAMESITE` | auto | `lax`, `strict`, or `none`; production defaults to `none` |
| `GOOGLE_CLIENT_ID` | empty | Google OAuth client ID; required in production |
| `GOOGLE_CLIENT_SECRET` | empty | Google OAuth client secret; required in production |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/api/auth/google/callback` | Must match Google Console; must be HTTPS in production |
| `DEV_AUTH_ENABLED` | `false` (the example enables it) | Local demo login; always rejected in production |
| `DEV_AUTH_EMAIL` | `dev@reachinbox.test` | Demo user email |
| `DEV_AUTH_NAME` | `Local Demo` | Demo user name |
| `EMBED_WORKER` | `true` in development, `false` otherwise | Run the delivery worker inside the API process; local mode needs this enabled and production uses a separate worker |
| `WORKER_CONCURRENCY` | `5` | Jobs processed in parallel per worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Server floor for the per-sender gap between sends |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Hourly cap for each sender |
| `RATE_WINDOW_MS` | `3600000` | Window length; use `60000` for a quick demo |
| `CLAIM_TTL_MS` | `120000` | Age after which a processing claim can be reclaimed |
| `SENDER_COUNT` | `3` | Ethereal senders provisioned per user |

For Supabase or another hosted PostgreSQL provider, use the session pooler or
direct connection on port `5432` when running migrations; the transaction
pooler on port `6543` does not support the required migration behavior. SQLite
is intended for local runs only. Render and other ephemeral hosts need the
PostgreSQL path because their local filesystem is not durable.

To demonstrate window rollover quickly, set `RATE_WINDOW_MS=60000` and
`MAX_EMAILS_PER_HOUR_PER_SENDER=3`.

### Frontend

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api` | API base URL seen by the browser |
| `NEXT_PUBLIC_DEV_AUTH_ENABLED` | `false` (the example enables it) | Show the local demo login button |
| `API_PROXY_TARGET` | empty | Server-side rewrite target for same-origin `/api` calls |

## API

Email endpoints require the session cookie. Errors have the shape
`{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | 200 when the database and, in BullMQ mode, Redis respond |
| `GET` | `/api/auth/google` | Returns the Google authorization URL |
| `GET` | `/api/auth/google/callback` | OAuth callback; sets the session cookie |
| `POST` | `/api/auth/google` | Google Identity Services credential exchange |
| `POST` | `/api/auth/dev-login` | Local-only demo session |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/logout` | Clears the session cookie |
| `POST` | `/api/schedule` | Schedule a batch (canonical) |
| `POST` | `/api/emails/schedule` | Alias used by the dashboard |
| `GET` | `/api/emails/scheduled` | Scheduled and processing rows, paginated |
| `GET` | `/api/emails/sent` | Sent and failed rows, paginated |
| `GET` | `/api/emails/stats` | Counts by status |
| `DELETE` | `/api/emails/:id` | Cancel a scheduled email and remove its job |
| `DELETE` | `/api/emails/scheduled` | Delete every queued scheduled email for the user |
| `POST` | `/api/admin/reconcile` | Authenticated database-to-queue repair |

Example request:

```json
{
  "subject": "Hello",
  "body": "<p>Body</p>",
  "recipients": ["a@example.com", "b@example.com"],
  "startAt": "2026-10-24T10:00:00.000Z",
  "delayBetweenEmailsMs": 2000,
  "maxEmailsPerHour": 100,
  "idempotencyKey": "batch_1719234567890_ab12cd"
}
```

`startTime`, `delayMs`, `delaySeconds`, `hourlyLimit`, and `maxEmailsPerHour`
are accepted as aliases. A `startAt` or `startTime` at or before the current
time is clamped to now, so immediate sends are accepted; the initial planned
slots are enqueued without delay, and later recipients still follow the delay
and hourly cap. The response is `202` with `batchId`, `total`,
`acceptedCount`, `firstSendAt`, `lastSendAt`, `delayMs`, and `hourlyLimit`.
Recipients beyond the current window are scheduled later, not rejected. The
returned pacing values are the effective values after server-side clamping.

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

The backend suite has 32 tests covering timestamp planning, window rollover,
per-sender overflow, hourly key scoping, a 1,000-email plan and 500-job
bulk-enqueue chunks, atomic claim conflicts, delay and hourly deferral,
deterministic message IDs, permanent failures, retry handling, per-user sender
provisioning (local and Ethereal), concurrent provisioning deduplication,
owned-versus-legacy sender selection, and the local pacer.

The zero-dependency local path has its own end-to-end check. It creates a
temporary SQLite database and outbox, starts the API on a free port, signs in,
schedules and delivers messages, cancels single and bulk rows, simulates an
interrupted `PROCESSING` row across a restart, and verifies stats. It removes
its temporary files afterward and does not touch ports 3000/4000 or your real
database:

```bash
npm run test:local
```

For a real Redis enqueue benchmark of 1,000 jobs (requires
`QUEUE_DRIVER=bullmq` and a reachable Redis), run:

```bash
cd backend
npm run test:load -- 1000
```

This uses a throwaway queue and sends no SMTP mail. It reports planning time,
enqueue time, planned windows, and job counts, then removes the queue. The
automated 1,000-email planning test does not need Redis. See
[HOW_TO_RUN.md](HOW_TO_RUN.md) for the demo checklist.

To exercise restart behavior manually:

1. Schedule several emails a few minutes ahead.
2. Stop the API and worker, then start them again.
3. Confirm the rows remain scheduled and the jobs send once at their planned
   times.
4. Empty Redis and restart the worker; the reconciler restores pending jobs from
   PostgreSQL.

## Deployment

The supported production layout is a Vercel dashboard with the Express API,
BullMQ worker, PostgreSQL, and Redis-compatible Key Value store on Render.
[DEPLOYMENT.md](DEPLOYMENT.md) contains the full setup, verification, and
troubleshooting runbook.

### Vercel frontend

- Import the repository with root directory `frontend` and framework Next.js.
- Set `NEXT_PUBLIC_API_BASE_URL=/api`,
  `NEXT_PUBLIC_DEV_AUTH_ENABLED=false`, and
  `API_PROXY_TARGET=https://<render-api-host>`.
- Register `https://<frontend>/api/auth/google/callback` in Google Cloud
  Console.
- The `/api/*` rewrite keeps the session cookie first-party. Without the proxy,
  cross-site cookies can be blocked by the browser.

### Render backend

- Apply the root `render.yaml` Blueprint. It creates Postgres 16, a Key Value
  instance with `noeviction` and persistence, the API web service, the separate
  worker, and a shared runtime environment group. The group sets
  `QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal`, so Render always uses the
  hosted path; SQLite and the local outbox are not used there.
- Set `FRONTEND_URL=https://<frontend>` and
  `GOOGLE_CALLBACK_URL=https://<frontend>/api/auth/google/callback` when prompted
  by the Blueprint, along with the Google client ID and secret.
- Both services run `prisma migrate deploy` as their pre-deploy command. The API
  is health-checked at `/health`; the worker runs `npm run start:worker` and must
  be a paid background worker.
- Keep `EMBED_WORKER=false`. The API never delivers mail.
- Paid Render instance types are required: free web services sleep, block the
  SMTP ports used by Ethereal, and free Key Value and Postgres instances are not
  durable.
- The API refuses to start in production without HTTPS URLs, Google OAuth
  credentials, a strong `JWT_SECRET`, and `DEV_AUTH_ENABLED=false`.

Ethereal remains a test SMTP sandbox in this deployment. The app behaves as it
does locally, but messages do not reach real inboxes.

### Docker

The root compose file can run on a single host. Provide production values for
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (32+ characters), `FRONTEND_URL`, and
the Google OAuth settings, then run:

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

The frontend proxies `/api` internally, so browsers only need the dashboard
origin. Terminate TLS in front of the frontend and keep PostgreSQL and Redis off
public interfaces. When using managed services, stop the local
`postgres`/`redis` containers.

## Requirement checklist

### Backend

- [x] TypeScript, Express, BullMQ, Redis, PostgreSQL, SQLite, and Ethereal SMTP
- [x] Scheduling API that stores recipients before enqueueing
- [x] Delayed BullMQ jobs in production and a database poller locally, with no
      cron or timer-based dispatcher
- [x] Zero-dependency local mode with a `.eml` outbox and synthetic senders
- [x] Per-user sender pools (local synthetic or Ethereal) with a legacy shared
      fallback
- [x] Restart persistence with database reconciliation in both modes
- [x] Idempotent submission, enqueueing, claiming, and message IDs
- [x] Configurable worker concurrency
- [x] Configurable minimum delay between sends
- [x] Configurable per-sender hourly limit backed by Redis in production and the
      local pacer in local mode
- [x] Over-limit jobs deferred to the next window, never dropped
- [x] Chunked inserts and bulk enqueueing for large batches
- [x] Retry with backoff and permanent-failure handling
- [x] Google OAuth and user-scoped data access

### Frontend

- [x] Google login and logout with name, email, and avatar
- [x] Scheduled and Sent views with status labels
- [x] Compose view with subject, body, recipients, CSV upload, start time
      (including Now for immediate delivery), delay between emails, and hourly
      limit
- [x] Detected recipient count after parsing an uploaded file
- [x] Loading, empty, and error states
- [x] Email detail view, single-email cancellation, and bulk scheduled deletion
- [x] Typed API responses and component props
- [x] Shared toast, icon, and layout components, with feature-specific views
      for the list, detail, compose, and uploader screens
- [x] Dashboard layout and green theme consistent with the supplied design notes

The compose form sends both the delay and hourly limit. The API clamps them to
the server minimum gap and per-sender cap, so a browser cannot weaken pacing.
The entered hourly limit applies to the batch, per sender, and the server-wide
`MAX_EMAILS_PER_HOUR_PER_SENDER` cap applies across all batches; the lower value
wins.

## Known limitations

- `/api/admin/reconcile` is protected by authentication but not by an admin
  role, and it is not exposed in the dashboard. This is intentionally accepted
  for the demo. Do not expose it in a multi-tenant production deployment without
  role checks.
- Local mode assumes one API process per SQLite file. On startup it releases
  every `PROCESSING` row, so running two local workers against the same database
  could send a row twice. Use the BullMQ mode when you need multiple workers.
- Local messages are written to `backend/.mail-outbox` and have no preview URL.
  They are files on disk, not delivered email. Removing the folder is safe after
  inspection; the database remains the record of what was sent.
- The local worker polls every 400 ms, so delivery can lag a scheduled time by
  roughly half a second; the configured send gap still applies.
- SQLite is for local evaluation only. Render and other hosts with ephemeral
  disks must use PostgreSQL.
- In BullMQ mode, Redis must run with `--maxmemory-policy noeviction`. If another
  local Redis container uses `volatile-lru`, BullMQ will warn and queued jobs
  may be evicted.
- Live Google OAuth and Ethereal delivery require external credentials and were
  not exercised by the automated test suite. A completed Google browser consent
  flow was not verified in the recorded work; earlier manual checks reached the
  Google redirect and token endpoint. The automated tests cover the planner,
  enqueue payloads, limiter deferral, and worker state transitions.
- The dashboard loads up to 100 rows per tab and has no pagination controls. The
  API accepts `page` and `limit`, so older rows are available through the API
  but cannot be reached in the current UI.
- No live Vercel or Render deployment was performed from this workspace. The
  Blueprint was checked against Render's documented schema, and the production
  build and `/api` rewrite were exercised locally. Live Google consent, Render
  SMTP delivery, and real-host cookie behavior still need the checks in
  [DEPLOYMENT.md](DEPLOYMENT.md) after you deploy.

## Assumptions and trade-offs

- SMTP delivery is at-least-once. A deterministic `Message-ID` helps receivers
  detect duplicates; true exactly-once delivery is not achievable.
- Fixed windows can allow a short burst at a boundary of up to twice the cap.
- A failed send consumes its reserved slot.
- Ethereal is a sandbox, so real provider throttling and inbox placement are not
  exercised.
- The API returns `202` after the database commit. A queue outage is repaired by
  reconciliation rather than rolled back, because the database is the source of
  truth.
- The dashboard polls every five seconds. In production, scheduling itself is
  push-based through delayed jobs; only the UI polls for fresh status. Local
  mode polls the database by design.
- `GET /health` checks the configured database and, in BullMQ mode, Redis. It
  returns 503 while a required dependency is unavailable; local mode therefore
  depends only on the SQLite file.
