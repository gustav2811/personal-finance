# Ingest — Cloudflare Workers

SendGrid → **ingest Worker** (token, multipart → **R2** + **Queue**) → **consumer Worker** (parse, Finwise, Supabase DLQ).

## Quick start

From the **repo root**:

```bash
yarn install
cd apps/ingest-cloudflare
yarn wrangler login          # once per machine
```

Create infrastructure (first time only):

```bash
yarn wrangler r2 bucket create investments-ingest
yarn wrangler queues create investments-email-ingest
```

Local dev (put secrets in **`apps/ingest-cloudflare/.dev.vars`**, not the repo root—see example file):

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars
yarn dev:ingest
yarn dev:consumer   # second terminal
```

Deploy (each `wrangler.*.toml` sets `keep_vars = true` so dashboard-only plain vars like `SUPABASE_URL` are not wiped):

```bash
yarn deploy:all
```

Set production secrets (from `apps/ingest-cloudflare`):

```bash
yarn wrangler secret put INGEST_TOKEN -c wrangler.ingest.toml
yarn wrangler secret put FINWISE_API_KEY -c wrangler.consumer.toml
yarn wrangler secret put SUPABASE_SERVICE_KEY -c wrangler.consumer.toml
```

## Full documentation

See **[docs/ingest-cloudflare.md](../../docs/ingest-cloudflare.md)** for SendGrid URLs, variables, and troubleshooting.

## Compared to generic Cloudflare tutorials

- **Do not** run `npm create cloudflare@latest` for this feature—the Worker code already lives here.
- **Prefer** `yarn wrangler` in this directory over `npm install -g wrangler` so the CLI matches `package.json`.
