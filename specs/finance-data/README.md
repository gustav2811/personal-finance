# Owned Finance Data and Classification

Status: draft
Date: 2026-08-25
Risk: high — financial data, schema migrations, external writes, and AI-assisted decisions

This spec set defines an owned financial dataset in Supabase and an agentic
categorisation workflow for every account, including FinWise-connected accounts
and manually imported Bank Zero statements.

## Reading order

1. [PRD](prd.md) — product outcome, scope, requirements, and rollout.
2. [Data model](data-model.md) — logical tables, relationships, and migration
   direction.
3. [Invariants](invariants.md) — rules the database and services must never
   violate.
4. [Agent workflow](agent-workflow.md) — sync, MCP, ToolLoopAgent, review,
   publishing, and evaluation.

## Core decisions

- Supabase owns the consolidated dataset and the owned categorisation.
- There is one `accounts` table and one `transactions` table for all sources.
  Never create tables per account, bank, or provider.
- FinWise is an upstream source for connected accounts.
- FinWise is a create-only projection for manually imported accounts.
- FinWise exports are the historical data source in scope. Overlapping legacy
  rows are reconciled to FinWise identities instead of maintained as another
  source.
- FinWise’s source category and the owned category are separate values.
- FinWise has no supported transaction-update operation. The system must never
  depend on updating a FinWise transaction after creation.
- Bank Zero rows are staged and classified before the FinWise create.
- Connected-account rows can receive improved local categories in Supabase
  without attempting to write corrections back to FinWise.
- The classifier is a Vercel AI SDK `ToolLoopAgent`, invoked through the Vercel
  AI Gateway.
- Agent tools are exposed through an authenticated finance MCP. MCP provides
  capabilities and data access; the agent owns classification reasoning.
- Agent predictions are proposals or audit records, not memory and not truth.
- Confirmed user decisions may become labelled examples and explicitly approved
  episodic rules.

## Current code anchors

These paths were inspected while drafting the specs:

- `apps/ingest-cloudflare/src/ingest.ts` — SendGrid webhook and R2 staging.
- `apps/ingest-cloudflare/src/consumer.ts` — Queue consumer and configuration.
- `apps/ingest-cloudflare/wrangler.consumer.toml` — consumer bindings and
  secrets.
- `libs/ingest-core/src/process-job.ts` — parsing, categorisation, and FinWise
  posting orchestration.
- `libs/ingest-core/src/lib/finwise.ts` — FinWise create and idempotency logic.
- `libs/ingest-core/src/lib/categorisation/` — current rules and direct Gemini
  batch classifier.
- `libs/finwise/` — typed FinWise REST client.
- `apps/dashboard/` — existing authenticated dashboard surface.
- `docs/categorisation.md` — prior hybrid categorisation notes.

## Explicit assumptions

- The existing `public.accounts` and `public.transactions` tables are
  pre-existing finance tables. Before implementation, inspect their deployed
  schema and choose an in-place evolution or a one-time migration with
  compatibility views. Use a FinWise export to backfill overlapping history.
  Do not create a second permanent canonical transaction store.
- The household is the access boundary. Current dashboard access is limited to
  Gustav and Cara; production policies must derive access from authenticated
  household membership.
- The model provider is intentionally unspecified. Model selection must route
  through AI Gateway and remain configuration-driven.
