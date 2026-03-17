# Ingest Webhook — Railway & SendGrid Setup

## Why two Railway services?

The app has two separate long-running processes:

1. **Web** — Fastify HTTP server. It receives SendGrid’s POST, validates the token, parses multipart form data, pushes a job to Redis, and returns **200 immediately**. That way SendGrid doesn’t time out or retry while we do heavy work.
2. **Worker** — BullMQ worker. It pulls jobs from Redis, parses the XLSX (bank-specific), talks to Finwise (with retries and idempotency), and writes failures to the DLQ. This can take seconds per email.

If the web server did parsing and Finwise calls itself, SendGrid might retry the webhook on timeout and we’d risk duplicate work. By splitting “accept and enqueue” (web) from “process” (worker), we control retries, scaling, and observability independently. So we run **two services**: one for HTTP, one for the job consumer.

---

## Railway

### 1. New project

- Create project → Deploy from GitHub repo (this repo).
- Set **Root Directory** to the **repo root** (leave empty or `.`) so `libs/finwise` is in the build context.

### 2. Services (config-as-code)

The repo includes two Railway config files. Create **two services** in the same project (same repo, same root directory). For each service, set the **custom config file** in service settings:

| Service | Config file path |
|--------|-------------------|
| Web    | `apps/ingest-webhook/railway-web.toml` |
| Worker | `apps/ingest-webhook/railway-worker.toml` |

Config-as-code defines build and deploy (see [Railway docs](https://docs.railway.com/config-as-code)); the only difference between the two is `startCommand` (`yarn start` vs `yarn worker`). Generate a **domain** for the **Web** service only (for the SendGrid webhook URL).

### 3. Redis

- Add **Redis** from Railway’s data services.
- Attach to the project; `REDIS_URL` is set automatically for services in the project.

### 4. Environment variables

Set in Railway → Variables (or per-service):

| Variable               | Example / note                                   |
| ---------------------- | ------------------------------------------------ |
| `INGEST_TOKEN`         | Long random secret (e.g. `openssl rand -hex 32`) |
| `FINWISE_API_KEY`      | From Finwise dashboard                           |
| `FINWISE_BASE_URL`     | Optional; default production                     |
| `SUPABASE_URL`         | Supabase project URL                             |
| `SUPABASE_SERVICE_KEY` | Supabase service role key                        |
| `BANK_ZERO_ACCOUNT_ID` | Finwise account ID for Bank Zero                 |
| `NODE_ENV`             | `production`                                     |
| `PORT`                 | Railway sets this; default 3000                  |

Do **not** commit these; use Railway (or a secret manager).

### 5. Health check (Web service)

- Path: `/`
- Expected: `200` with body `{ "status": "ok" }`. Set in `railway-web.toml` via `healthcheckPath`.

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
