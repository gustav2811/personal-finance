# Investments

Yarn monorepo for **bank statement email ingest** (SendGrid webhooks → parse attachments → Finwise and Supabase) and the owned household finance dataset.

## Layout

| Path | Package | Purpose |
|------|---------|---------|
| [`apps/ingest-cloudflare`](apps/ingest-cloudflare) | `@investments/ingest-cloudflare` | Cloudflare Workers — SendGrid webhook accepts payloads to R2, queue triggers consumer (mailparser, XLSX parsers, Finwise, Supabase). The consumer cron also pulls ISMRT electricity, water, and wallet into `consumption`. |
| [`libs/ingest-core`](libs/ingest-core) | `@investments/ingest-core` | Shared logic: mailparser, XLSX parsing, Finwise upload, Supabase DLQ / idempotency. |
| [`libs/finwise`](libs/finwise) | `@investments/finwise` | Small Finwise API client used by ingest code. |
| [`tools/electricity`](tools/electricity) | *(Python tools)* | Manual Lelit Bianca backfill and the electricity report. Not the ISMRT path. |
| [`apps/dashboard`](apps/dashboard) | `@investments/dashboard` | Household dashboard. shadcn design system. |
| [`supabase/migrations`](supabase/migrations) | *(SQL migrations)* | Finance-data schema migrations, including household consumption. |
| [`data/consumption`](data/consumption) | *(ignored private data)* | Raw household inputs and generated ISMRT/electricity extracts. |
| [`reports/electricity`](reports/electricity) | *(ignored private reports)* | Generated HTML/PDF electricity reports. |

Routine work uses Yarn workspaces. Read [`AGENTS.md`](AGENTS.md) before opening more of the repo.

## Prerequisites

- **Node.js 20** (matches CI)
- **Yarn 1.x** — version pinned via `packageManager` in root [`package.json`](package.json)

## Install

```bash
yarn install
```

Use a single install at the repo root so `file:` links between packages resolve.

## Commands

**Ingest core (unit tests)**

```bash
yarn workspace @investments/ingest-core test
```

**Cloudflare ingest** — from `apps/ingest-cloudflare`:

```bash
yarn dev:ingest
yarn dev:consumer
yarn types              # tsc --noEmit
yarn deploy:ingest
yarn deploy:consumer
yarn deploy:all
```

Wrangler is a devDependency of that app; prefer `yarn wrangler` from `apps/ingest-cloudflare`. Setup (R2, queues, secrets, `.dev.vars`) is in [docs/ingest-cloudflare.md](docs/ingest-cloudflare.md).

**Household consumption**

ISMRT electricity, water, and wallet load on the ingest consumer cron. See
[docs/consumption-model.md](docs/consumption-model.md). The Lelit Bianca backfill
is still manual:

```bash
python3 tools/electricity/load_espresso_to_supabase.py
python3 tools/electricity/build_report.py
```

**Household dashboard**

```bash
yarn workspace @investments/dashboard dev
```

The dashboard uses the Supabase publishable key in the browser and relies on
RLS for the household allowlist. It never uses `SUPABASE_SERVICE_KEY`. Setup
details live in [`apps/dashboard/README.md`](apps/dashboard/README.md).

The electricity report reads the raw household CSV from
`data/consumption/electricity/raw/` and writes HTML under `reports/electricity/`.
Bneta plug data still uses a manual CSV backfill. Automated plug retrieval is
not wired yet.

## Documentation

- [docs/ingest-cloudflare.md](docs/ingest-cloudflare.md) — Cloudflare Workers, R2, Queues, Wrangler, local dev, deploy.
- [docs/consumption-model.md](docs/consumption-model.md) — normalized household consumption model and ingestion notes.

## CI and deployment

| Workflow | When | What |
|----------|------|------|
| [`.github/workflows/pr.yml`](.github/workflows/pr.yml) | Pull requests to `master` | `ingest-core` tests, `ingest-cloudflare` typecheck, Wrangler bundle dry-runs for ingest and consumer (non-fork PRs with Cloudflare secrets). |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Push to `master` | Deploys both Cloudflare Workers (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). |

## License

MIT (see root [`package.json`](package.json)).
