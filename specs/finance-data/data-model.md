# Owned Finance Data Model

Status: draft
Parent: [Owned Finance Data and Agentic Categorisation](README.md)
Risk: high — existing finance tables, migrations, RLS, and historical data

## Design rule

The logical model contains one `accounts` table and one `transactions` table
for every financial source. Account, provider, and ingestion differences are
represented by columns and related metadata, not by separate transaction
tables.

The physical schema must be decided after inspecting the deployed finance
database. The repository documents existing `public.accounts` and
`public.transactions` tables containing legacy provider data, but their
creation migrations are not present here. Use a FinWise export or sync as the
historical source in scope. Implementation SHALL either:

1. evolve those existing tables in place; or
2. move them once into a dedicated finance schema and provide compatibility
   views during migration.

A second permanent canonical transaction store is forbidden.

## Source and ownership model

```text
Bank Zero statement ───────────────┐
                                   ├─> owned accounts + transactions
FinWise connected-account sync ────┘

owned category + treatment + event role
        │
        └─> optional FinWise projection
            POST for Bank Zero creates
            PATCH for connected category writeback
```

Source systems provide observations. Supabase owns the normalized copy used by
the dashboard, agent, semantic search, and owned categorisation.

FinWise category data is retained as source metadata. It is not the same as the
owned category.

## Core tables

The following are logical definitions. Exact local ID types and existing
compatibility columns must be resolved during migration design.

### `households`

One row per ownership and access boundary.

Required fields:

- `id`
- `created_at`

### `household_members`

Maps authenticated identities to households and roles.

Required fields:

- `household_id`
- `auth_user_id`
- `role`
- `created_at`

Unique key:

```text
(household_id, auth_user_id)
```

### `accounts`

One row per logical account, regardless of provider.

Required fields:

- `id` — internal stable ID
- `household_id`
- `source_system` — `finwise`, `bank_zero`, or another registered source
- `source_account_id` — stable ID in the source system
- `name`
- `account_type`
- `currency_code`
- `lifecycle_status`
- `created_at`
- `updated_at`

FinWise and synchronization fields:

- `finwise_account_id` — nullable unique external ID
- `source_updated_at`
- `first_seen_at`
- `last_seen_at`
- `archived_at`
- `raw_payload`
- `raw_payload_hash`

Recommended account lifecycle values:

```text
active
archived
missing_from_source
```

An account name is display data, never identity.

### `account_balance_snapshots`

Point-in-time source observations of an account balance. This preserves the
existing balance-sync concept without mixing balances into transaction rows.

Required fields:

- `id`
- `household_id`
- `account_id`
- `source_system`
- `as_of_at`
- `amount` — exact numeric value
- `currency_code`
- `observed_at`
- `sync_run_id`
- `raw_payload_hash`

Optional fields:

- `raw_payload`
- `source_balance_id`
- `available_amount`

Recommended uniqueness key:

```text
(household_id, account_id, source_system, as_of_at)
```

### `transactions`

One row per source transaction event.

Required fields:

- `id` — internal stable ID
- `household_id`
- `account_id`
- `source_system`
- `source_transaction_id`
- `amount` — exact numeric value
- `currency_code`
- `occurred_on` — source transaction date
- `description`
- `lifecycle_status`
- `created_at`
- `updated_at`

Source fields:

- `original_description`
- `source_category_id`
- `source_category_name_snapshot`
- `source_updated_at`
- `source_first_seen_at`
- `source_last_seen_at`
- `source_is_pending`
- `source_is_transfer`
- `source_is_archived`
- `raw_payload`
- `raw_payload_hash`

Publication fields:

- `finwise_transaction_id` — nullable unique external ID
- `publication_status`
- `published_at`
- `publication_error`

Optional typed fields:

- `posted_at`
- `effective_at`
- `notes`
- `merchant_name`
- `merchant_source_id`
- `parent_transaction_id`

The typed columns are the query surface. Raw source JSON is evidence and
reprocessing input, not a replacement for typed facts.

### `transaction_source_observations`

Append-only source snapshots for transactions that can be revised by a
provider. The latest observation may be copied onto `transactions` for fast
reads, but the observation history remains recoverable.

Required fields:

- `id`
- `household_id`
- `transaction_id`
- `sync_run_id`
- `observed_at`
- `source_updated_at` — nullable when the source supplies no revision time
- `raw_payload`
- `raw_payload_hash`

Recommended uniqueness key:

```text
(transaction_id, raw_payload_hash)
```

### `categories`

The household-owned categorisation taxonomy.

Required fields:

- `id`
- `household_id`
- `name`
- `group_id` — nullable
- `lifecycle_status`
- `created_at`
- `updated_at`

Recommended additional fields:

- `slug`
- `description`
- `sort_order`
- `archived_at`

FinWise category IDs may be mapped to owned categories, but source IDs must not
be assumed to be owned category IDs.

### `source_categories`

The latest known category catalogue for a source system. This is source
metadata, not the household-owned taxonomy.

Required fields:

- `id`
- `household_id`
- `source_system`
- `source_category_id`
- `name`
- `group_id` — nullable
- `group_name` — nullable when the source exposes only a group ID
- `lifecycle_status`
- `observed_at`
- `raw_payload`
- `raw_payload_hash`

Recommended uniqueness key:

```text
(household_id, source_system, source_category_id)
```

### `transaction_classifications`

Append-only history of owned category decisions. Category is independent of
spend treatment. Do not store `is_transfer` or event role here.

Required fields:

- `id`
- `household_id`
- `transaction_id`
- `category_id`
- `decision_source` — `imported`, `rule`, `jev`, `agent`, `user`, or `policy`
- `status` — `proposed`, `confirmed`, `rejected`, or `superseded`
- `confidence` — nullable exact numeric value from `0` to `1`
- `actor_id` — nullable authenticated user
- `agent_run_id` — nullable
- `reason`
- `created_at`
- `confirmed_at`
- `superseded_at`

There SHALL be at most one active confirmed classification per transaction.
The current classification may be exposed through a view or a denormalized
`owned_category_id` pointer on `transactions`, but the history remains the
audit record.

### `classification_proposals`

Work queue and dashboard review state for agent output.

Required fields:

- `id`
- `household_id`
- `transaction_id`
- `agent_run_id`
- `proposed_category_id` — nullable for an explicit abstention
- `confidence` — nullable when the agent abstains
- `needs_review`
- `status` — `pending`, `approved`, `rejected`, `corrected`, or `expired`
- `evidence_transaction_ids`
- `created_at`
- `reviewed_at`
- `reviewed_by`

An approved proposal creates a confirmed row in
`transaction_classifications`. Approval SHALL not mutate the source category.

### `classification_feedback`

Immutable record of a dashboard review action.

Required fields:

- `id`
- `household_id`
- `transaction_id`
- `proposal_id` — nullable when correcting an existing classification
- `review_command_id` — stable idempotency key
- `reviewer_id`
- `action` — `approved`, `rejected`, or `corrected`
- `selected_category_id` — nullable for rejection without replacement
- `note` — nullable
- `created_at`

Feedback is the trusted link between a human decision and later labelled
examples or an episodic-rule proposal.

Unique key:

```text
(household_id, review_command_id)
```

### `classification_runs`

Immutable audit record for each agent execution.

Required fields:

- `id`
- `household_id`
- `transaction_id` or batch identifier
- `agent_version`
- `prompt_version`
- `model_id`
- `started_at`
- `completed_at`
- `status`
- `step_count`
- `input_token_count`
- `output_token_count`
- `error`
- `result`

Store tool names and evidence IDs. Do not treat this table as agent memory.

### `transaction_embeddings`

Derived semantic-search index.

Required fields:

- `transaction_id`
- `embedding`
- `embedding_model`
- `embedding_version`
- `input_content_hash`
- `created_at`

The embedding SHALL be regenerated when the normalized input changes or the
embedding version changes.

### `episodic_rules`

Explicitly approved household preferences extracted from user feedback.

Required fields:

- `id`
- `household_id`
- `rule_text`
- `scope`
- `status` — `proposed`, `approved`, `disabled`
- `source_feedback_id`
- `created_at`
- `approved_at`
- `approved_by`

This table stores approved knowledge, not unreviewed agent thoughts.

### `sync_runs`

Audit and operational state for source synchronization.

Required fields:

- `id`
- `household_id`
- `source_system`
- `account_id` — nullable for multi-account runs
- `started_at`
- `completed_at`
- `status`
- `window_start`
- `window_end`
- `rows_seen`
- `rows_inserted`
- `rows_updated`
- `rows_skipped`
- `rows_failed`
- `error`

## Identity and relationships

Recommended uniqueness rules:

```text
accounts:
  (household_id, source_system, source_account_id)
  (household_id, finwise_account_id) where finwise_account_id is not null

transactions:
  (household_id, account_id, source_system, source_transaction_id)
  (household_id, finwise_transaction_id) where finwise_transaction_id is not null
```

Required foreign keys:

```text
accounts.household_id → households.id
account_balance_snapshots.account_id → accounts.id
account_balance_snapshots.sync_run_id → sync_runs.id
transactions.household_id → households.id
transactions.account_id → accounts.id
transaction_source_observations.transaction_id → transactions.id
transaction_source_observations.sync_run_id → sync_runs.id
transaction_classifications.transaction_id → transactions.id
transaction_classifications.category_id → categories.id
classification_proposals.transaction_id → transactions.id
classification_proposals.proposed_category_id → categories.id
classification_feedback.transaction_id → transactions.id
classification_feedback.proposal_id → classification_proposals.id
classification_feedback.selected_category_id → categories.id
transaction_embeddings.transaction_id → transactions.id
episodic_rules.source_feedback_id → classification_feedback.id
```

Financial rows should use `ON DELETE RESTRICT` or soft deletion. Cascading
deletion from a household or account must not silently remove posted financial
history.

## Category representation

Use separate concepts:

```text
source_category_id
  FinWise’s current imported category identifier

source_category_name_snapshot
  Name observed at sync time

owned category
  Category in the household taxonomy

transaction_classifications
  Versioned decision history for the owned category
```

For the first implementation, the owned taxonomy may mirror FinWise’s current
44-category catalogue. Keep the IDs separate so the taxonomy can improve
without coupling the database to FinWise IDs. Connected categories can be
projected back with `PATCH /transactions/:id`. The source category stays in
`originalTransactionCategoryId`.

### `financial_events`

One economic event spanning one or more canonical transactions.

Required fields:

- `id`
- `household_id`
- `event_type` — `internal_movement`, `reserve_funding`, `internal_conversion`,
  `settlement`, `purchase`, or `income`
- `status` — `proposed`, `confirmed`, or `superseded`
- `created_at`

### `financial_event_legs`

Links a canonical transaction to an event.

Required fields:

- `id`
- `household_id`
- `event_id`
- `transaction_id`
- `leg_role` — `economic_recognition`, `mirror`, `staging`, `reserve_funding`,
  `internal_conversion`, or `settlement`
- `created_at`

A transaction belongs to at most one active event.

### `transaction_treatments`

Append-only owned spend treatment. Independent of category.

Required fields:

- `id`
- `household_id`
- `transaction_id`
- `is_transfer`
- `exclude_from_spend`
- `nature`
- `event_id` — nullable until reconciliation
- `leg_role` — nullable until reconciliation
- `decision_source` — `imported`, `rule`, `jev`, `agent`, `user`, or `policy`
- `status` — `proposed`, `confirmed`, `rejected`, or `superseded`
- `created_at`

Reporting uses `exclude_from_spend` and `leg_role`, not
`category <> 'Transfers'`.

Account and relationship semantics, when added, reference canonical
`accounts.id`. They must not be keyed by FinWise account IDs, and they must
not live in a parallel `classifier` schema.

## Lifecycle

### Connected FinWise transaction

```text
source_seen
  → imported
  → classified
  → confirmed or pending_review
```

The transaction is already published in FinWise. Supabase stores its source
category and may add an improved owned category.

### Bank Zero transaction

```text
staged
  → classified
  → pending_review | approved
  → ready_to_publish
  → published | publish_failed
```

The FinWise ID is null until the create request succeeds or is reconciled as an
existing transaction.

## Sync boundaries

FinWise-to-Supabase synchronization may update only source-owned fields:

- account metadata;
- source transaction facts;
- source category snapshot;
- pending/archive state;
- source timestamps and raw payload.

It must not update:

- owned category;
- confirmed classification history;
- user feedback;
- approved episodic rules;
- review outcome.

Bank Zero ingestion writes the same canonical tables. It must not create a
provider-specific transaction table.

## Indexing

At minimum, index:

- all foreign keys;
- account lookup by household and source;
- transaction lookup by account and occurred date;
- transaction lookup by household and lifecycle status;
- publication status;
- pending review proposals;
- active classification lookup;
- partial unique FinWise IDs;
- source identity conflict keys.

Add a `pgvector` nearest-neighbour index only after selecting the embedding
dimension and measuring the dataset. The vector index is derived and
rebuildable.

## Migration direction

1. Inspected 2026-09-25. `public.accounts` has `account_id`, `name`,
   `source_account_id`, `source_platform`, and `type`. `public.transactions`
   has `id`, `account_id`, `date`, and `details`. The old 22seven rows were
   removed. FinWise is the only financial source. Do not create a second
   transaction store.
2. Export or sync all accounts visible in the user’s FinWise account, together
   with their transactions and categories.
3. Reconcile overlapping existing rows against FinWise source identities.
4. Mark unmatched legacy rows out of scope or retain them as quarantined
   history. Do not add a separate legacy-provider adapter or delete rows
   automatically.
5. Add household ownership and source identity fields.
6. Preserve existing raw `details` data while adding typed query columns.
7. Convert `processed_transactions` into a migration-compatible idempotency
   mechanism backed by transaction source identity.
8. Add append-only source observations and backfill one observation for each
   imported source payload.
9. Backfill FinWise accounts, transactions, categories, and source labels.
10. Introduce owned classification and proposal tables.
11. Add compatibility views only if existing readers require the old shape.
12. Remove legacy write paths only after row-count and identity reconciliation.

No migration may drop or rewrite financial history without an export,
reconciliation report, and rollback plan.
