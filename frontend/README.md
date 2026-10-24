# ReachInbox Dashboard

Next.js 16 dashboard for the ReachInbox email scheduler. It talks to the Express
API in `../backend`; all scheduling, persistence, rate limiting, and delivery are
handled by the backend.

The dashboard shows the signed-in user's name, email, and avatar; schedules
batches with a start time (including **Now** for immediate delivery), delay, and
hourly limit; lists scheduled and sent messages with status and times; supports
CSV/text lead upload; and can cancel a single scheduled email or delete all
queued scheduled emails.

## Local development

The easiest path is from the repository root. It prepares the backend, database,
and this frontend and starts everything together:

```bash
npm run dev
```

Open <http://localhost:3000> and click **Continue in local demo mode**. No Google
credentials, Docker, PostgreSQL, or Redis are needed: the backend defaults to
SQLite and writes messages to `backend/.mail-outbox`. The script creates
`.env.local` with:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_DEV_AUTH_ENABLED=true
```

To run this app by itself, start the backend first (see
[`../backend/README.md`](../backend/README.md)), then:

```bash
npm install
cp .env.example .env.local
npm run dev
```

For a Docker-only run, `docker compose up --build` from the repository root
builds this app with `NEXT_PUBLIC_API_BASE_URL=/api` and
`NEXT_PUBLIC_DEV_AUTH_ENABLED=true`, proxies `/api` to the API container, and
shows **Continue in local demo mode** on the login screen. That path is
production-shaped: it forces PostgreSQL, Redis, BullMQ, and Ethereal SMTP. The
backend demo endpoint is disabled in production. Email/password login is never
supported.

## Scripts

```bash
npm run dev      # development server
npm run lint     # ESLint
npm run build    # production build
npm start        # production server
```

## Vercel

Deploy this app as a Vercel project with root directory `frontend`; deploy the
API and BullMQ worker on Render. To keep the session cookie first-party, point
the frontend at its own `/api` and proxy to Render:

```text
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_DEV_AUTH_ENABLED=false
API_PROXY_TARGET=https://your-render-api.onrender.com
```

The rewrite is defined in `next.config.ts` and runs at build time, so changing
`API_PROXY_TARGET` requires a redeploy. Also set the backend
`GOOGLE_CALLBACK_URL` to
`https://your-frontend.vercel.app/api/auth/google/callback` and `FRONTEND_URL`
to the frontend origin.

The BullMQ worker cannot run on Vercel. The Render Blueprint in `render.yaml`
creates it as a separate background worker with access to the same Postgres and
Redis instances. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for the full runbook.

## Structure

```text
src/app/            Dashboard page and layout
src/components/     Auth, layout, email tables, compose, detail views
src/hooks/          useAuth (session) and useEmails (fetch/polling)
src/services/       Auth and email API services
src/lib/api-client.ts
src/types/api.ts    Frontend API contract
```

The existing visual theme is preserved:

- Primary green `#00A859`
- Mint accents `#EAF7EE` / `#A7F3D0`
- Background `#F8F9FA`
