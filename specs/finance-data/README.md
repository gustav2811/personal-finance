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
4. [Agent workflow](agent-workflow.md) — sync, JEV classification, escalation
   agent, review, and projection.

## Core decisions

- Supabase owns the consolidated dataset and the owned categorisation.
- There is one `accounts` table and one `transactions` table for all sources.
  Never create tables per account, bank, or provider.
- FinWise is an upstream source for connected accounts.
- FinWise is a source and an optional projection. Connected rows may be
  written back with the tested `PATCH /transactions/:id`. `originalTransactionCategoryId`
  remains the source category.
- FinWise exports are the historical data source in scope. Overlapping legacy
  rows are reconciled to FinWise identities instead of maintained as another
  source. FinWise IDs are external identifiers, not the durable primary key.
- Owned category and spend treatment are independent decisions. A transfer flag
  does not imply the category `Transfers`, and `Investments` may still be
  excluded from spend.
- Bank Zero rows are staged and classified before a FinWise create.
- The normal classifier is the measured JEV worker. An agent is the escalation
  path for novel or ambiguous rows, not the default classifier.
- Do not apply a standalone `classifier.*` schema keyed by FinWise IDs. Durable
  account and relationship facts hang off canonical `accounts.id`.
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
