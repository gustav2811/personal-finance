# Investments

Yarn monorepo for **bank statement email ingest** (SendGrid webhooks → parse attachments → Finwise and Supabase) plus scheduled balance/transaction sync scripts.

## Layout

| Path | Package | Purpose |
|------|---------|---------|
| [`apps/ingest-cloudflare`](apps/ingest-cloudflare) | `@investments/ingest-cloudflare` | Cloudflare Workers — SendGrid webhook accepts payloads to R2, queue triggers consumer (mailparser, XLSX parsers, Finwise, Supabase). |
| [`libs/ingest-core`](libs/ingest-core) | `@investments/ingest-core` | Shared logic: mailparser, XLSX parsing, Finwise upload, Supabase DLQ / idempotency. |
| [`libs/finwise`](libs/finwise) | `@investments/finwise` | Small Finwise API client used by ingest code. |
| [`apps/src/functions`](apps/src/functions) | *(scripts, not a workspace)* | Node scripts invoked by GitHub Actions (e.g. daily 22seven → Supabase sync). |

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

**One-off scripts** (examples)

```bash
yarn tsx apps/src/functions/syncBalances.ts
yarn tsx apps/src/functions/syncTransactions.ts
```

## Documentation

- [docs/ingest-cloudflare.md](docs/ingest-cloudflare.md) — Cloudflare Workers, R2, Queues, Wrangler, local dev, deploy.

## CI and deployment

| Workflow | When | What |
|----------|------|------|
| [`.github/workflows/pr.yml`](.github/workflows/pr.yml) | Pull requests to `master` | `ingest-core` tests, `ingest-cloudflare` typecheck, Wrangler bundle dry-runs for ingest and consumer (non-fork PRs with Cloudflare secrets). |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Push to `master` | Deploys both Cloudflare Workers (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). |
| [`.github/workflows/sync-transactions.yml`](.github/workflows/sync-transactions.yml) | Daily schedule + manual | Runs snapshot and transaction sync scripts under `apps/src/functions/` with Supabase / 22seven secrets. |

## License

MIT (see root [`package.json`](package.json)).
