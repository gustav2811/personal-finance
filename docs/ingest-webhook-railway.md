# Ingest Webhook — Railway & SendGrid Setup

## Railway

### 1. New project

- Create project → Deploy from GitHub repo (this repo).
- Optionally use **Monorepo** and set **Root Directory** to `apps/ingest-webhook`.

### 2. Services

Run two processes:

- **Web**: start command `yarn start` (or `node --import tsx src/server.ts`). Exposes HTTP for SendGrid webhook and health.
- **Worker**: same root directory, start command `yarn worker`. Consumes jobs from Redis and posts to Finwise.

### 3. Redis

- Add **Redis** from Railway’s data services.
- Attach to the project; `REDIS_URL` is set automatically for services in the project.

### 4. Environment variables

Set in Railway → Variables (or per-service):

| Variable | Example / note |
|----------|-----------------|
| `INGEST_TOKEN` | Long random secret (e.g. `openssl rand -hex 32`) |
| `FINWISE_API_KEY` | From Finwise dashboard |
| `FINWISE_BASE_URL` | Optional; default production |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `BANK_ZERO_ACCOUNT_ID` | Finwise account ID for Bank Zero |
| `NODE_ENV` | `production` |
| `PORT` | Railway sets this; default 3000 |

Do **not** commit these; use Railway (or a secret manager).

### 5. Health check

- Path: `/`
- Expected: `200` with body `{ "status": "ok" }`.

### 6. Domain

- Railway can assign a default `*.railway.app` domain.
- For SendGrid, use that URL or attach a custom domain (e.g. `ingest.yourdomain.com`) and use it in the webhook URL.

---

## SendGrid Inbound Parse

### 1. MX record

For the receiving domain (e.g. `parse.klingbiel.org`):

- **Type**: MX  
- **Host**: `parse` (or `@` for root)  
- **Value**: `mx.sendgrid.net`  
- **Priority**: 10  

Confirm with `dig MX parse.klingbiel.org` (or your domain).

### 2. Inbound Parse settings

- SendGrid → **Settings** → **Inbound Parse**.
- **Add Host & URL**:
  - **Receiving domain**: `parse.klingbiel.org`
  - **Destination URL**:  
    `https://<railway-host>/webhook/sendgrid?token=<INGEST_TOKEN>`
- Optional: **POST the raw, full MIME message** if you want to store raw emails later.
- Save.

### 3. Test

Send an email to e.g. `statements@parse.klingbiel.org` with an XLSX statement attachment. Check:

- Webhook returns 200.
- Worker logs show job processed.
- Finwise has the new transactions (and duplicates are skipped on resend).

---

## Minimal acceptance

- [ ] MX points to SendGrid; Inbound Parse URL is set.
- [ ] `POST /webhook/sendgrid` with valid token returns 200 and enqueues a job.
- [ ] Worker processes the job and posts to Finwise.
- [ ] Same email sent twice does not create duplicate transactions.
- [ ] Failed jobs appear in Supabase `dlq_ingest_jobs`.
