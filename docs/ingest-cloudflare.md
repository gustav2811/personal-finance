# Ingest — Cloudflare (Workers + R2 + Queues)

This path replaces the always-on **Railway** web + worker + **Redis** stack with:

- **Ingest Worker** — `POST` from SendGrid, token check, multipart → **R2**, message to **Cloudflare Queue**, fast `200`.
- **Consumer Worker** — reads queue, loads objects from R2, runs the same pipeline as before (**mailparser** + XLSX parsers + **Finwise** + **Supabase** DLQ / processed ids).

Shared logic lives in [`libs/ingest-core`](../libs/ingest-core). Code for the Workers is in [`apps/ingest-cloudflare`](../apps/ingest-cloudflare).

For the legacy Railway setup, see [ingest-webhook-railway.md](./ingest-webhook-railway.md).

---

## What you do *not* need (vs generic tutorials)

- **`npm create cloudflare@latest`** — This repository **already** contains the Worker project under `apps/ingest-cloudflare`. You only install dependencies and deploy with **Wrangler** using the provided `wrangler.*.toml` files.
- **`npm install -g wrangler`** — Optional. This monorepo pins **Wrangler** as a devDependency of `@investments/ingest-cloudflare`. Prefer **`yarn wrangler`** (from that app) or **`npx wrangler`** after `yarn install` at the repo root so the CLI version matches the project.

---

## One-time: Wrangler login

You authenticate **once per machine** (and per Cloudflare account you use for deploy):

```bash
cd /Users/<>/repos/investments
yarn install
cd apps/ingest-cloudflare
yarn wrangler login
```

That opens a browser; approve access. Same idea as in ad-hoc docs, but run the **project’s** Wrangler via Yarn instead of a global install.

No `wrangler login` is required for **production CI** if you use [API token / `CLOUDFLARE_API_TOKEN`](https://developers.cloudflare.com/workers/wrangler/ci-cd/) in the environment.

---

## Prerequisites in Cloudflare

Names below match [`wrangler.ingest.toml`](../apps/ingest-cloudflare/wrangler.ingest.toml) and [`wrangler.consumer.toml`](../apps/ingest-cloudflare/wrangler.consumer.toml). Change the TOMLs if you pick different names.

### 1. R2 bucket

```bash
cd apps/ingest-cloudflare
yarn wrangler r2 bucket create investments-ingest
```

### 2. Queue

```bash
yarn wrangler queues create investments-email-ingest
```

---

## Install (monorepo)

From the **repository root**:

```bash
yarn install
```

Yarn workspaces include `libs/finwise`, `libs/ingest-core`, `apps/ingest-webhook`, and `apps/ingest-cloudflare`. Use this single install; do not rely on a separate lockfile under `apps/ingest-webhook`.

---

## Local development (`wrangler dev`)

Wrangler loads **`apps/ingest-cloudflare/.dev.vars`** when you run commands from **`apps/ingest-cloudflare`** (same directory as the config files). A root-level `.dev.vars` is **not** read automatically unless you point Wrangler at it.

1. Copy the example:

   ```bash
   cp apps/ingest-cloudflare/.dev.vars.example apps/ingest-cloudflare/.dev.vars
   ```

2. Fill in secrets (see table below).

3. Run (two terminals if you want HTTP + consumer locally):

   ```bash
   cd apps/ingest-cloudflare
   yarn dev:ingest
   ```

   ```bash
   cd apps/ingest-cloudflare
   yarn dev:consumer
   ```

`[vars]` in `wrangler.consumer.toml` (e.g. `SUPABASE_URL`, `BANK_ZERO_ACCOUNT_MAP`, `BANK_ZERO_ACCOUNT_ID`) apply in dev too. For **Bank Zero**, set **`BANK_ZERO_ACCOUNT_MAP`** to the same JSON array you use on Railway (same shape as local `account.map.json`: `pattern`, `accountId`, optional `accountNumber`). Override in the dashboard or in **`apps/ingest-cloudflare/.dev.vars`** (see `.dev.vars.example`). See [Workers local development](https://developers.cloudflare.com/workers/development-testing/local-development/).

---

## Deploying the Workers (production)

From **`apps/ingest-cloudflare`**:

```bash
yarn deploy:ingest    # HTTP ingest only
yarn deploy:consumer # Queue consumer only
# or
yarn deploy:all
```

Both Wrangler files set **`keep_vars = true`**. Without that, Wrangler **deletes** every plain-text variable not listed in the TOML before deploy, which would wipe dashboard-only values like `SUPABASE_URL`. With **`keep_vars`**, the upload API keeps existing dashboard vars and still applies **`[vars]`** from the TOML (e.g. `FINWISE_BASE_URL`, `UPLOAD_TO_FINWISE` on the consumer).

You are **not** creating a new project with `npm create cloudflare`; you are uploading these two entrypoints to your Cloudflare account.

### “Deploying will override…” / vars shown with a minus sign

If this Worker was last changed in the **Cloudflare dashboard**, Wrangler compares **remote vs local** and prints a diff. Extra dashboard-only vars show with **`-`** even when **`keep_vars = true`**. That check **does not** understand `keep_vars`: it only looks at the TOML vs downloaded config.

**With `keep_vars = true`, answering `Y` is safe** — the real deploy sends `keep_bindings` for plain-text/json vars, so **`SUPABASE_URL` and `BANK_ZERO_ACCOUNT_MAP` are not removed.** The message is misleading.

After a successful deploy **via Wrangler**, Cloudflare usually stops treating the script as “last edited in dashboard,” so this prompt **often goes away** until you edit that Worker in the UI again.

**If you want zero prompts in CI**, run in a non-interactive context and avoid `--strict`, or pipe confirmation — Wrangler’s UX here is still rough; the durable fix is managing all plain vars in files (e.g. a **gitignored** vars source) or only touching this Worker through Wrangler.

After the first deploy, note the **ingest** Worker URL (e.g. `https://investments-ingest.<subdomain>.workers.dev` or your custom route). Use that as the SendGrid Inbound Parse **destination URL** (see below).

### Secrets (production)

Set via Wrangler (run from `apps/ingest-cloudflare`):

| Worker | Command | Purpose |
|--------|---------|---------|
| Ingest | `yarn wrangler secret put INGEST_TOKEN -c wrangler.ingest.toml` | Same value as `INGEST_TOKEN` on Railway |
| Consumer | `yarn wrangler secret put FINWISE_API_KEY -c wrangler.consumer.toml` | Finwise API key |
| Consumer | `yarn wrangler secret put SUPABASE_SERVICE_KEY -c wrangler.consumer.toml` | Supabase service role key |

**`SUPABASE_URL`**, **`BANK_ZERO_ACCOUNT_MAP`**, and optional **`BANK_ZERO_ACCOUNT_ID`** are **not** in the committed `wrangler.consumer.toml` so you can keep them only in the **Cloudflare dashboard** (or `.dev.vars` locally). Set them under **Workers → `investments-ingest-consumer` → Settings → Variables**. The TOML only sets **`FINWISE_BASE_URL`** and **`UPLOAD_TO_FINWISE`**, and **`keep_vars = true`** ensures dashboard vars survive deploy (see warning section above).

---

## SendGrid cutover

1. Deploy **both** Workers and confirm the ingest URL responds (e.g. `POST` with wrong token → `401`).
2. In SendGrid → **Inbound Parse**, set **Destination URL** to (same shape as Railway):

   `https://<your-ingest-worker-host>/webhook/sendgrid?token=<INGEST_TOKEN>`

   The ingest Worker also accepts `POST /` for quick tests (e.g. default `workers.dev` root).

3. Keep **Include attachments** enabled; enable **POST raw MIME** if you relied on that for parsing (same as Railway doc).

4. Send a test message; confirm consumer logs (dashboard or `wrangler tail`) and Finwise / Supabase.

5. When satisfied, stop Railway web + worker + Redis to avoid double processing.

---

## Architecture (quick reference)

```text
SendGrid → Ingest Worker → R2 + Queue → Consumer Worker → Finwise API
                                              ↘ Supabase (DLQ + processed_transactions)
```

---

## Daily cron (Supabase keep-alive + DLQ summary)

The **consumer** Worker has a **Cron Trigger** (`[triggers]` in [`wrangler.consumer.toml`](../apps/ingest-cloudflare/wrangler.consumer.toml)): **07:00 UTC every day** it runs a lightweight query against `dlq_ingest_jobs` — a `count` with `created_at >= now() - 7 days` (no row payload). That:

1. **Touches Supabase regularly** so a free project is less likely to hit the ~7-day inactivity pause when bank imports only run monthly.
2. **Logs a small report** you can watch in **Workers → Logs** or `wrangler tail`: JSON with `msg: "dlq_daily_report"`, `window_days`, `dlq_count`.

If `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are unset, the cron logs `dlq_cron_skipped` and does nothing.

To change the schedule, edit `crons` in `wrangler.consumer.toml` (see [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)). Local testing: `wrangler dev -c wrangler.consumer.toml --test-scheduled` and visit **`/__scheduled`** in the browser to run the handler once.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `401` from ingest | `INGEST_TOKEN` query or `Authorization: Bearer` must match the secret. |
| Queue never drains | Consumer deployed? Same queue name in both TOMLs? Consumer bound to the queue? |
| R2 errors | Bucket name matches `bucket_name` in both configs. |
| Bundle / Node APIs | Consumer uses `nodejs_compat`; ingest does not need it. |

---

## Minimal acceptance (Cloudflare)

- [ ] R2 bucket and queue exist; names match Wrangler config.
- [ ] `yarn deploy:all` succeeds; secrets and vars set on both Workers.
- [ ] SendGrid POST hits ingest Worker; response `200` with `{ "job_id", "status": "queued" }`.
- [ ] Consumer processes the message; Finwise shows new transactions when `UPLOAD_TO_FINWISE` is true.
- [ ] Failures still land in Supabase `dlq_ingest_jobs` when applicable.
