# Production Deployment: Vercel Frontend and Render Backend

This guide deploys the dashboard to Vercel and the Express API, BullMQ worker,
PostgreSQL, and Redis-compatible Key Value store to Render. The Vercel project
proxies `/api/*` to Render, so the browser sees one origin and the session cookie
stays first-party.

The repository contains `render.yaml` for a Render Blueprint. No production
deployment has been performed as part of this repository, so treat the checks in
this guide as the verification steps to run after you deploy.

## Architecture

```text
Browser
  -> https://<frontend>.vercel.app
     -> Next.js dashboard
     -> /api/* rewrite
        -> https://<api>.onrender.com
           -> Render Postgres
           -> Render Key Value (Redis)
           -> Render background worker
              -> Ethereal SMTP
```

The API and worker use the same PostgreSQL database and the same Redis instance.
The API never sends mail. The worker is a separate always-on Render process and
is required for delivery. This deployment uses the hosted path only:
`QUEUE_DRIVER=bullmq` and `MAIL_TRANSPORT=ethereal`. SQLite, the in-process
worker, and the `.eml` outbox are local-only and must not be used on Render,
whose filesystem is ephemeral.

## Before you start

- Push this repository to GitHub, GitLab, or Bitbucket. A Render Blueprint reads
  `render.yaml` from the repository.
- Create a Vercel account and a Render account.
- Create a Google OAuth 2.0 Web application.
- Use paid Render instance types. The required production behavior is not
  available on Render's free tier:
  - Free web services sleep after inactivity and block outbound SMTP ports 25,
    465, and 587.
  - Background workers are a paid service type.
  - Free Key Value instances do not provide persistence, and BullMQ requires
    `noeviction`.
  - Free Postgres instances expire.
- Ethereal is the delivery provider in this project. It is a test SMTP sandbox:
  messages do not reach real recipients. The deployment preserves local
  behavior, including Ethereal preview links, but it is not a production email
  service.

## Step 1: Deploy the frontend to Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `frontend`.
3. Keep **Framework Preset** as Next.js.
4. Add these environment variables for Production:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` |
| `NEXT_PUBLIC_DEV_AUTH_ENABLED` | `false` |
| `API_PROXY_TARGET` | `https://<render-api-host>` |

`API_PROXY_TARGET` is the Render API origin only: no trailing slash and no
`/api` suffix. You can set it after Step 3. Changing it requires a new Vercel
deployment because the rewrite is generated during the build.

5. Deploy and copy the production frontend URL, for example
   `https://reachinbox.vercel.app`.

Use a Vercel project whose Root Directory is `frontend`. The configuration file
is `frontend/vercel.json`, and the rewrite environment variables must be present
in the Vercel project itself. Do not deploy from the repository root: Vercel
would look for `next` in the root `package.json`, which is a workspace manifest,
and fail with `NEXT_NO_VERSION`.

## Step 2: Create the Google OAuth client

In Google Cloud Console, create an OAuth 2.0 client of type **Web application**
and add this exact authorized redirect URI:

```text
https://<frontend>.vercel.app/api/auth/google/callback
```

Copy the client ID and client secret. Configure the OAuth consent screen for
external users (or add your Google account as a test user while the app is in
testing). The backend refuses to start in production without the credentials,
without an HTTPS `FRONTEND_URL`, and without an HTTPS `GOOGLE_CALLBACK_URL`.

The callback is on the frontend domain because Vercel proxies `/api` to Render.
Do not register the Render domain unless you deliberately switch to the direct
cross-origin setup described below.

## Step 3: Deploy the backend with the Render Blueprint

1. In Render, choose **New > Blueprint**.
2. Connect the repository and apply `render.yaml`.
3. Render prompts for the API's `sync: false` values:

| Variable | Value |
| --- | --- |
| `FRONTEND_URL` | `https://<frontend>.vercel.app` |
| `GOOGLE_CALLBACK_URL` | `https://<frontend>.vercel.app/api/auth/google/callback` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

`FRONTEND_URL` is the frontend origin with no trailing slash. It controls CORS
and the post-login redirect.

The Blueprint creates:

- `reachinbox-db`: Render Postgres 16, private network access only.
- `reachinbox-kv`: Render Key Value with `noeviction` and journal-snapshot
  persistence.
- `reachinbox-api`: Node web service running the Express API.
- `reachinbox-worker`: Node background worker running BullMQ delivery.
- `reachinbox-runtime`: a shared environment group that keeps the API's and
  worker's pacing and rate-limit settings identical.

Both Node services run this build:

```text
npm ci --include=dev && npm run build
```

Both run this pre-deploy migration before starting:

```text
npx prisma migrate deploy
```

The API starts with `npm run start` and is health-checked at `/health`. The
worker starts with `npm run start:worker`. The worker has no HTTP endpoint and
will not appear in the browser.

All resources use the same Render region. Internal database and Key Value URLs
only work when the services and datastores share a region. If you change the
region, change it for every resource.

4. Wait for the database, Key Value instance, API, and worker to deploy. A
   successful API deploy ends with a passing `/health` check and a log line that
   the API is listening.
5. Copy the API's public URL, for example
   `https://reachinbox-api.onrender.com`.

### If the Render services already exist

You can keep existing services and apply the same settings instead of creating a
new Blueprint:

API web service:

- Runtime: Node
- Root Directory: `backend`
- Build Command: `npm ci --include=dev && npm run build`
- Pre-Deploy Command: `npx prisma migrate deploy`
- Start Command: `npm run start`
- Health Check Path: `/health`
- Instance type: any paid plan

Background worker:

- Runtime: Node
- Root Directory: `backend`
- Build Command: `npm ci --include=dev && npm run build`
- Pre-Deploy Command: `npx prisma migrate deploy`
- Start Command: `npm run start:worker`
- Instance type: any paid plan

Both services need `DATABASE_URL` and `REDIS_URL` from the same-region Postgres
and Key Value instances. Set `NODE_ENV=production`, `QUEUE_DRIVER=bullmq`,
`MAIL_TRANSPORT=ethereal`, the same strong `JWT_SECRET` on both,
`DEV_AUTH_ENABLED=false`, `COOKIE_SAMESITE=none`, `EMBED_WORKER=false`, and
identical `WORKER_CONCURRENCY`, `MIN_DELAY_BETWEEN_EMAILS_MS`,
`MAX_EMAILS_PER_HOUR_PER_SENDER`, `RATE_WINDOW_MS`, `CLAIM_TTL_MS`, and
`SENDER_COUNT` values.

The API also needs `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
and `GOOGLE_CALLBACK_URL`. Make sure the Key Value instance uses
`maxmemory-policy noeviction` and has persistence enabled. A free Key Value
instance is not a reliable BullMQ deployment.

## Step 4: Connect Vercel to Render

Set the Vercel Production `API_PROXY_TARGET` to the Render API origin:

```text
API_PROXY_TARGET=https://reachinbox-api.onrender.com
```

Redeploy the Vercel project. The rewrite in `frontend/next.config.ts` now sends
`/api/*` to Render.

The browser should use `https://<frontend>.vercel.app/api/*`; it should never
need to know the Render host. This keeps the `sid` cookie first-party and avoids
third-party cookie blocking.

## Step 5: Verify the deployment

Run these checks in order. Replace the hostnames with your own.

1. Direct API health:

   ```bash
   curl -i https://reachinbox-api.onrender.com/health
   ```

   Expect `200` with `"status":"ok"` when Postgres and Key Value are reachable.

2. Proxied health through Vercel:

   ```bash
   curl -i https://<frontend>.vercel.app/api/health
   ```

   This must return the same status. If it returns a Vercel 404, the frontend
   was built without `API_PROXY_TARGET` or the deployment has not been rebuilt.

3. Open the dashboard, sign in with Google, and confirm the header shows your
   name, email, and avatar.

4. Compose a batch with **Now (send immediately)** and a recipient you can
   inspect in the Ethereal preview. Confirm the scheduled row appears, then wait
   for the worker poll and confirm it moves to Sent with a preview link.

5. Cancel one scheduled email and confirm it disappears from Scheduled.

6. Open the Render worker logs. On startup the worker logs a reconciliation
   message and then job completion lines. Restart the worker from the Render
   dashboard; pending rows in Postgres should be reconciled back into Redis and
   delivered once.

7. Optionally flush the Key Value instance during a test window and restart the
   worker. The startup reconciler rebuilds pending delayed jobs from Postgres.

## Environment variables

### Render API

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | Injected from the Render Postgres connection string |
| `REDIS_URL` | yes | Injected from the Render Key Value connection string |
| `QUEUE_DRIVER` | yes | `bullmq`; enables Redis delayed jobs and the Redis rate-limit gate |
| `MAIL_TRANSPORT` | yes | `ethereal`; switches delivery from local `.eml` files to SMTP |
| `JWT_SECRET` | yes | At least 32 characters and not a documented placeholder; the Blueprint generates one |
| `FRONTEND_URL` | yes | Frontend origin, HTTPS, no trailing slash |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | yes | Frontend origin plus `/api/auth/google/callback` |
| `DEV_AUTH_ENABLED` | yes | `false` in production |
| `COOKIE_SAMESITE` | recommended | `none` for direct cross-site access; the proxy also works |
| `EMBED_WORKER` | yes | `false`; use the separate worker |
| `LOG_LEVEL` | optional | `info` |
| `WORKER_CONCURRENCY` | optional | Default `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | optional | Default `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | optional | Default `100` |
| `RATE_WINDOW_MS` | optional | Default `3600000` |
| `CLAIM_TTL_MS` | optional | Default `120000` |
| `SENDER_COUNT` | optional | Default `3` Ethereal senders per user |

### Render worker

The worker needs `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and the
same pacing and rate-limit settings as the API. It does not read Google OAuth or
`FRONTEND_URL`. The Blueprint shares those settings through the
`reachinbox-runtime` group.

### Vercel frontend

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | yes | `/api` |
| `NEXT_PUBLIC_DEV_AUTH_ENABLED` | yes | `false`; removes the local demo button |
| `API_PROXY_TARGET` | yes | Render API origin, no `/api` suffix |

`NEXT_PUBLIC_*` values are embedded in the browser bundle at build time. Do not
put secrets in them.

## Authentication and cookies

- Production requires Google OAuth. The local demo endpoint always returns 404
  when `NODE_ENV=production`.
- The session is a signed JWT in an HTTP-only, Secure `sid` cookie. The cookie is
  set with `SameSite=None` in production unless overridden.
- With the Vercel proxy, the cookie is issued by the browser's own origin and is
  first-party. Login, logout, and `/api/auth/me` should all work without
  third-party cookie exceptions.
- A direct browser-to-Render API setup uses a cross-site cookie. Some browsers
  block it. Prefer the proxy, or put both services behind custom domains under
  the same registrable domain.
- Changing `JWT_SECRET` signs out every user.

## Database migrations and restarts

- Migrations run through Render's pre-deploy command on both services.
  `prisma migrate deploy` uses an advisory lock, so concurrent pre-deploys are
  safe.
- The worker runs reconciliation at startup. It releases stale `PROCESSING`
  claims and recreates missing BullMQ jobs from Postgres.
- Postgres is the source of truth. Redis can be rebuilt, but it must not evict
  jobs while the worker is running.
- For a manual migration, use the Render shell or a machine that can reach the
  database:

  ```bash
  cd backend
  DATABASE_URL='<render-postgres-connection-string>' npx prisma migrate deploy
  ```

- `npm run seed:senders` is an optional repair command for existing users. It is
  not part of normal deployment; senders are provisioned on first sign-in.

## Scaling and operations

- One API instance and one background worker are enough for this application.
  A paid worker runs continuously; delivery timing is controlled by BullMQ
  delayed jobs, not by HTTP traffic.
- Multiple workers are safe because the per-sender pacing reservation is atomic
  in Redis. Keep `WORKER_CONCURRENCY` and the pacing values identical across
  workers.
- The API's `/health` check verifies both Postgres and Key Value. Use it as the
  Render health check and for uptime monitoring.
- Watch worker logs for `job failed` and `worker error`. Permanent SMTP failures
  mark rows `FAILED`; transient failures retry with backoff.
- Enable Render Postgres backups appropriate for your plan before storing
  important data.
- Restrict Postgres and Key Value to private network access. The Blueprint does
  this with `ipAllowList: []`.

## Render platform notes

- Paid instance types are required for an always-on API, a background worker,
  persistent Key Value, and a non-expiring database. The Blueprint's plans are a
  starting point; resize them in Render if needed.
- Render's free web services block outbound SMTP ports 25, 465, and 587, which
  prevents Ethereal delivery from a free web service. The Blueprint runs
  delivery in a paid background worker, which is not subject to that free-tier
  restriction.
- The API and worker need outbound internet access to
  `api.nodemailer.com` for Ethereal sender provisioning. The provisioning call
  happens on first sign-in.
- Render sets `PORT` and `NODE_ENV=production` for Node services at runtime. The
  Blueprint also sets `NODE_ENV` and `LOG_LEVEL` explicitly.
- The build installs dev dependencies because the build needs TypeScript and the
  Prisma CLI. Do not change the build command to `npm ci --omit=dev`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Vercel fails with `NEXT_NO_VERSION` or "Could not identify Next.js version" | The Vercel Root Directory is the repository root. Set it to `frontend`, keep Framework Preset as Next.js, and redeploy. The install command should be `npm install`, not `npm install --prefix frontend` |
| Vercel custom domain assignment fails | The production deployment must be Ready first. If the domain is already attached to another Vercel project or account, remove it there. Add the exact DNS records Vercel shows for the domain, then wait for verification |
| Vercel warns that `engines.node` will auto-upgrade | Optional: set the project's Node.js version to 22.x in Vercel project settings, or pin `engines.node` to a fixed major. This warning does not cause the build failure |
| API exits with `[env] Invalid environment configuration` | `JWT_SECRET` is at least 32 characters, is not a documented placeholder, `DEV_AUTH_ENABLED=false`, and required URLs are valid |
| API logs `invalid production configuration` | `FRONTEND_URL` and `GOOGLE_CALLBACK_URL` must be HTTPS and both Google credentials must be set |
| `/health` returns 503 | Postgres or Key Value is unavailable; verify `DATABASE_URL` and `REDIS_URL` and same-region networking |
| Login redirects with `redirect_uri_mismatch` | The Google Console redirect URI must match `GOOGLE_CALLBACK_URL` exactly, including the Vercel domain and path |
| Login succeeds but the dashboard immediately shows logged out | The frontend is probably calling Render directly without a third-party cookie exception. Set `NEXT_PUBLIC_API_BASE_URL=/api` and `API_PROXY_TARGET` |
| `/api/health` returns a Vercel 404 | `API_PROXY_TARGET` is missing, points at the wrong host, or the Vercel project was not rebuilt after setting it |
| CORS 403 in the browser | `FRONTEND_URL` must be the exact frontend origin, with no trailing slash |
| Worker runs but no messages are sent | Check the worker logs, confirm the worker points at the same `REDIS_URL` and `DATABASE_URL`, and confirm the service is paid (SMTP ports are blocked on free web services) |
| Prisma migration fails in pre-deploy | The database must be reachable from the service; use the internal connection string and do not point at a transaction pooler |
| Emails stay `SCHEDULED` | The worker is down, the queue is not reachable, or the enqueue warning was ignored. Restart the worker and check reconciliation logs |
| Health says `queueDriver: local` on Render | `QUEUE_DRIVER` is missing or overridden. Set it to `bullmq` on both services and redeploy |
| No `.eml` outbox exists on Render | Expected: `MAIL_TRANSPORT=ethereal` writes no local files. If it is `local`, the messages were not sent over SMTP |

## Direct API access without the proxy

The proxy is the recommended setup. If you deliberately call Render directly:

- Set the Vercel `NEXT_PUBLIC_API_BASE_URL` to
  `https://<render-api-host>/api` and leave `API_PROXY_TARGET` empty.
- Register `https://<render-api-host>/api/auth/google/callback` in Google and use
  that value for `GOOGLE_CALLBACK_URL`.
- Keep `COOKIE_SAMESITE=none` and HTTPS.
- Expect some browsers to block the cross-site session cookie. Custom domains on
  the same registrable domain avoid most of this problem.

## Production caveats

- Ethereal is a sandbox. Replace the mailer with a real provider before sending
  mail to real recipients.
- `/api/admin/reconcile` is authenticated but has no administrator role. This is
  intentional for the demo and should not be exposed as-is in a multi-tenant
  production environment.
- The session is a stateless seven-day JWT; there is no server-side revocation
  list. Logging out clears the browser cookie but does not revoke an already
  issued token.
- Delivery is at-least-once. A deterministic `Message-ID` helps receivers detect
  duplicates after a crash.
- Fixed hourly windows can allow a boundary burst of up to twice the configured
  cap.
- The dashboard loads up to 100 rows per tab and polls every five seconds; it has
  no page controls.
