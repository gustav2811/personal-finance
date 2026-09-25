# Investments

Yarn monorepo for **bank statement email ingest** (SendGrid webhooks → parse attachments → Finwise and Supabase) and the owned household finance dataset.

## Layout

| Path | Package | Purpose |
|------|---------|---------|
| [`apps/ingest-cloudflare`](apps/ingest-cloudflare) | `@investments/ingest-cloudflare` | Cloudflare Workers — SendGrid webhook accepts payloads to R2, queue triggers consumer (mailparser, XLSX parsers, Finwise, Supabase). |
| [`libs/ingest-core`](libs/ingest-core) | `@investments/ingest-core` | Shared logic: mailparser, XLSX parsing, Finwise upload, Supabase DLQ / idempotency. |
| [`libs/finwise`](libs/finwise) | `@investments/finwise` | Small Finwise API client used by ingest code. |
| [`tools/ismrt`](tools/ismrt) | *(Python tools)* | ISMRT wallet API client, probes, exports, and API notes. |
| [`tools/electricity`](tools/electricity) | *(Python tools)* | Household electricity analysis and dark HTML report builder. |
| [`apps/dashboard`](apps/dashboard) | `@investments/dashboard` | Common Orbit — private, read-only household usage dashboard. |
| [`supabase/migrations`](supabase/migrations) | *(SQL migrations)* | Finance-data schema migrations, including household consumption. |
| [`data/consumption`](data/consumption) | *(ignored private data)* | Raw household inputs and generated ISMRT/electricity extracts. |
| [`reports/electricity`](reports/electricity) | *(ignored private reports)* | Generated HTML/PDF electricity reports. |

The repo root is an [Nx](https://nx.dev) workspace scaffold (`nx.json`, `nx` in devDependencies); **routine work uses Yarn workspaces**, not Nx targets.

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

**Household consumption tools**

Add `ISMRT_USERNAME` and `ISMRT_PASSWORD` to the local, ignored `.env`, then load
it into the shell without printing it:

```bash
set -a; source .env; set +a
python3 tools/ismrt/probe_ismrt_api.py --days 120
python3 tools/ismrt/export_ismrt_daily.py --days 120
python3 tools/ismrt/load_to_supabase.py
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

The ISMRT probe writes private extracts under
`data/consumption/ismrt/`. The electricity report reads the raw household CSV
from `data/consumption/electricity/raw/` and writes HTML under
`reports/electricity/`.

The ISMRT loader writes the extracts into the private `consumption` schema in
the `finance-data` Supabase project through a service-role-only RPC. Bneta plug
data currently uses the same RPC through a manual CSV backfill loader; automated
Bneta retrieval is not wired yet.

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
