# Agentic Classification Workflow

Status: draft
Parent: [Owned Finance Data and Agentic Categorisation](README.md)
Runtime direction: Cloudflare Workers/Queues/Workflows, Supabase, dashboard,
Vercel AI SDK, Vercel AI Gateway

## Purpose

Define the classification workflow. JEV is the normal classifier. An agent is
the escalation path for novel or ambiguous rows, and a separate optimizer may
propose improvements from corrections. Neither agent is the financial database,
the FinWise source of truth, or an unbounded writer.

## Architecture

```text
                         ┌─────────────────────┐
FinWise connected ──────>│                     │
accounts sync             │  Supabase finance  │<──── Dashboard
                         │  owned dataset     │      review/corrections
Bank Zero webhook ──────>│                     │
                         └─────────┬───────────┘
                                   │
                              Queue/Workflow
                                   │
                          ┌─────────▼───────────┐
                          │  JEV classifier      │
                          │  via AI Gateway      │
                          └─────────┬───────────┘
                                    │
                          ambiguous or novel tail
                                    │
                          ┌─────────▼───────────┐
                          │  research agent     │
                          └─────────┬───────────┘
                                   │
                         authenticated finance MCP
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
       prior transactions    categories/rules       semantic search

owned decision ──> optional FinWise projection (POST create or PATCH category)
```

## Component responsibilities

### FinWise sync job

- Enumerate and fetch all accounts visible in the user’s FinWise account, not
  only Discovery.
- Fetch source transactions and source category metadata.
- Upsert source facts into the canonical Supabase model.
- Preserve owned classifications and reviewer decisions.
- Record sync windows, counts, errors, and source revisions.

### Bank Zero ingest

- Authenticate and accept the SendGrid webhook.
- Store the raw input in R2 when required for replay.
- Enqueue a durable import envelope.
- Parse, normalize, validate, and stage transactions in Supabase.
- Never call FinWise before the staged transaction exists.

### Classification workflow

- Resolve deterministic rules first.
- Invoke the agent only when policy says context or reasoning is needed.
- Persist an immutable agent run and a proposal.
- Apply auto-approval policy only when all required conditions pass.
- Place uncertain rows in dashboard review.
- Publish only final Bank Zero decisions.

### Finance MCP

- Expose narrow, typed, household-scoped read tools.
- Query Supabase-owned data.
- Return evidence with stable IDs and provenance.
- Reject cross-household or out-of-scope requests.
- Never expose unrestricted SQL or service credentials.

### Dashboard

- Display source facts, owned decisions, proposals, and evidence.
- Allow authenticated approval, rejection, and correction.
- Record actor and timestamp for each review action.
- May project an owned category back to FinWise. The source category remains
  the original observation.

### FinWise adapter/MCP

The adapter supports source reads and the tested `PATCH /transactions/:id`
category update, plus create for unpublished Bank Zero rows. Publication and
writeback are server-controlled. The classifier does not receive a general
FinWise write tool.

The classification agent should not receive a general FinWise write tool.
Publication is a server-controlled workflow step after validation and final
decision.

Do not expose a fake `classify_transaction` operation. JEV classifies the
normal path. The research agent may use household-scoped tools only for the
unresolved tail. The owned decision is persisted in Supabase.
If a FinWise MCP is retained for integration, its read surface may include
accounts, transactions, and categories, while its create surface is restricted
to the publication workflow.

## Durable workflow

Each import or reclassification gets a stable `workflow_id` and correlation
ID. Steps should be independently retryable and idempotent.

### Step 1 — Capture

Persist the source envelope:

- `workflow_id`;
- source system;
- source account identity;
- source statement/message identity;
- raw object location or payload hash;
- received timestamp.

Duplicate envelopes resolve to the existing workflow.

### Step 2 — Parse and normalize

Convert provider-specific rows into the canonical transaction input:

- source identity;
- account mapping;
- exact amount and currency;
- source event date/time;
- original description;
- normalized merchant and memo tokens;
- source category snapshot, if present;
- raw payload reference.

Unknown account mappings stop in quarantine. They must not create orphan
transactions.

### Step 3 — Stage in Supabase

Upsert the canonical transaction by source identity. Mark Bank Zero rows
`staged`. This write must commit before any classification or FinWise create.

### Step 4 — Deterministic context

Run cheap, explainable signals:

1. exact normalized merchant and memo rule;
2. confirmed historical majority for the same merchant/context;
3. approved episodic rule;
4. semantic nearest neighbours;
5. candidate category constraints.

If deterministic policy produces an unambiguous confirmed decision, the agent
may be skipped. The decision still receives an audit record.

### Step 5 — Agent run

Call JEV for the normal row. Escalate to the research agent only when the
decision is novel, ambiguous, or below the accept policy.
The agent may call finance MCP tools to gather context. It returns structured
output, not free-form text consumed by a parser.

A model failure, tool failure, invalid category, or context authorization
failure produces `needs_review` or a failed run. It never produces an invented
category.

### Step 6 — Persist proposal

In one database transaction:

1. persist `classification_runs`;
2. persist the proposal and evidence IDs;
3. record model, prompt, agent, and category-catalogue versions;
4. apply the configured policy;
5. create a confirmed classification only if policy permits.

The transaction must not overwrite source category fields.

### Step 7 — Review or publish

```text
needs_review = true
  → dashboard pending item
  → approve / reject / correct
  → confirmed owned classification

final Bank Zero decision
  → ready_to_publish
  → FinWise create
  → publication mapping
  → published
```

Connected FinWise transactions stop after owned classification. Their source
category remains unchanged in Supabase.

## ToolLoopAgent contract

The implementation SHALL use the current installed Vercel AI SDK API and
verify it against the local package documentation before coding. In current
AI SDK versions, the intended pattern is `ToolLoopAgent` with a bounded
`stopWhen` condition such as `stepCountIs(...)`; do not copy obsolete
`maxSteps` or `Experimental_Agent` examples.

The model SHALL be supplied through the Vercel AI Gateway. Model selection is
configuration-driven:

```text
AI Gateway
  → configured model route
  → provider selected by deployment configuration
```

Do not hardcode a provider API key or commit a model choice as a domain rule.
The selected model ID and gateway request metadata must be recorded on every
agent run.

### Input

```text
transaction:
  id
  account_id
  account_type
  amount
  currency_code
  occurred_at
  description
  normalized_merchant
  memo_tokens
  source_category_snapshot

category_catalogue:
  id
  name
  group
  description

policy:
  auto_approve_threshold
  max_retrieval_results
  require_human_review_for
```

The input must not include the hidden target label during evaluation.

### Output

```text
category_id: string | null
confidence: number | null
needs_review: boolean
alternative_category_ids: string[]
evidence_transaction_ids: string[]
rationale: string
abstention_reason: string | null
```

The output validator SHALL require:

- category ID is in the current household catalogue or null;
- confidence is between `0` and `1` or null;
- `needs_review` is explicit;
- evidence IDs are bounded and validated;
- abstention reason is present when no category is selected.

Rationale is explanatory audit data. It is not a source fact and must not be
used as an unreviewed rule.

## Finance MCP tool contract

All tools receive authorization context from the authenticated server, not
from model-supplied household IDs. Inputs and outputs use strict schemas.

### `get_transaction`

Read one owned transaction and its source/category summary.

Required input:

```text
transaction_id
```

Output includes only the authorized household row and provenance.

### `search_transactions`

Search typed transaction fields and confirmed classifications.

Allowed filters:

- normalized merchant;
- description tokens;
- account;
- date range;
- amount direction/range;
- owned category;
- source system.

The server applies household scope and result limits.

### `search_similar_transactions`

Run semantic or hybrid retrieval over version-compatible embeddings.

Required behavior:

- same-household results only;
- exclude the target transaction;
- return transaction IDs, similarity score, category status, and source date;
- prefer confirmed user/policy classifications;
- mark model-only proposals as untrusted or exclude them by default.

### `get_category_catalog`

Return active owned categories, groups, descriptions, and catalogue version.

### `get_source_finwise_category`

Return the FinWise source category snapshot for a transaction, if available.
This tool is evidence, not an instruction to use the source category as the
owned category.

### `get_confirmed_rules`

Return active approved household rules and their scope. Do not return raw
agent thoughts or unreviewed proposals as rules.

## Classification policy

Use a predictable precedence order:

1. explicit user correction for this transaction;
2. approved deterministic rule;
3. confirmed historical evidence with a clear majority;
4. agent proposal above auto-approval threshold and with sufficient evidence;
5. dashboard review;
6. abstention if context is unavailable or contradictory.

An implementation may tune thresholds, but policy must be versioned and
recorded with the decision.

Auto-approval should require all of:

- category exists and is active;
- output validates;
- confidence meets the configured threshold;
- required evidence is present;
- no conflicting user rule;
- no prohibited transaction type;
- workflow has no unresolved source or account conflict.

Confidence alone is never sufficient when policy marks the transaction type as
review-required.

## Review semantics

### Approve

Confirm the proposed category. Create a confirmed classification, link the
proposal and reviewer, and optionally create a candidate episodic rule for
separate approval.

### Correct

Confirm the reviewer-selected category. Supersede the proposal, preserve the
agent run, and store the correction as a labelled example.

### Reject

Mark the proposal rejected. Leave the transaction unclassified unless the
reviewer selects a replacement.

### Rule extraction

A correction may suggest a rule, but rule creation requires a distinct,
explicit approval. Rules must be scoped, editable, disableable, and linked to
the originating feedback.

## FinWise publication

Publication is a create-only projection:

1. check the canonical transaction is `ready_to_publish`;
2. acquire the persisted publication idempotency key;
3. call FinWise create;
4. record response ID and timestamp;
5. mark `published`;
6. on ambiguous timeout, reconcile before retrying.

If FinWise creation fails, retain the canonical transaction and a durable
`publish_failed` state. A retry must not create a duplicate.

No step may issue a category update for an existing FinWise transaction.

## Embedding and retrieval pipeline

Build retrieval text from stable, non-sensitive fields selected by policy:

```text
normalized merchant
description tokens
memo tokens
account type
direction
amount bucket
source category snapshot
```

Do not embed full raw statements by default. Store the content hash,
embedding model/version, and transaction ID. Rebuild embeddings when the
normalized input or model version changes.

Use hybrid retrieval:

1. exact/alias match;
2. lexical search;
3. vector similarity;
4. category-consistency reranking.

Retrieval results must include enough provenance for the agent and reviewer to
understand why they were selected.

## Evaluation

The existing FinWise raw/hidden dumps can seed a classifier evaluation set.
Evaluation uses the production tool contract in read-only mode.

For each target transaction:

- hide the target category;
- exclude the target row from retrieval;
- exclude future trusted labels for temporal evaluation;
- record retrieved evidence and agent steps;
- compare prediction against a trusted label;
- record abstention and review outcomes.

Report:

- exact-match accuracy;
- top-k accuracy;
- macro accuracy by category;
- abstention rate;
- incorrect auto-approval rate;
- reviewer correction rate;
- retrieval hit rate;
- latency;
- gateway/model cost.

Do not use the evaluation result to silently alter production policy.

## Reliability and observability

Persist and log structured metadata:

- `workflow_id`;
- `sync_run_id`;
- `agent_run_id`;
- `transaction_id`;
- `source_system`;
- `account_id`;
- state transition;
- attempt number;
- model ID/version;
- tool names and result counts;
- duration;
- token usage;
- error class.

Logs must exclude API keys, access tokens, raw statement bodies, and
unnecessary full descriptions.

Use Cloudflare Queue retries and a durable failure/DLQ path. A workflow may be
retried only when every side effect is idempotent.

## Rollout plan

### Phase 0 — Data contract

- Inventory deployed finance schema and existing readers.
- Implement source identity and household ownership mapping.
- Define category catalogue and decision statuses.
- Add reconciliation queries.

### Phase 1 — Owned sync

- Sync all FinWise accounts into Supabase.
- Preserve source category snapshots.
- Add idempotent sync run records.
- Do not change user-visible categorisation yet.

### Phase 2 — Staged Bank Zero

- Persist parsed Bank Zero transactions before FinWise.
- Add publication states and reconciliation.
- Keep the existing deterministic categoriser as a shadow comparison.

### Phase 3 — MCP and agent shadow mode

- Build read-only finance MCP.
- Add semantic embeddings.
- Run `ToolLoopAgent` without auto-approval.
- Compare agent output with deterministic rules and reviewed labels.

### Phase 4 — Dashboard review

- Display proposals and evidence.
- Capture approve/reject/correct actions.
- Promote only confirmed feedback into retrieval and episodic rules.

### Phase 5 — Controlled publication

- Enable high-confidence auto-approval only for approved transaction types.
- Publish Bank Zero rows after final decision.
- Monitor duplicate, failure, and correction rates.

### Phase 6 — Historical improvement

- Reclassify connected-account history in batches.
- Keep source FinWise categories visible.
- Measure improvements without mutating FinWise.
