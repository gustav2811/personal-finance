---
spec_id: FINANCE-DATA-001
title: Owned finance dataset and agentic categorisation
type: product-and-technical-requirements
status: draft
risk: high
created: 2026-08-25
---

# Owned Finance Dataset and Agentic Categorisation

## Summary

Build a household-owned financial dataset in Supabase and classify transactions
with JEV. An agent is only the escalation path for novel or ambiguous rows.
The dataset must combine all accounts in one relational model: FinWise-connected
accounts such as Easy Equities, Discovery Bank, and IBKR, plus manually imported
Bank Zero data.

Supabase owns the consolidated facts and the household’s current categorisation.
FinWise is an upstream source and an optional projection. New Bank Zero rows
are created in FinWise. Category updates use the tested `PATCH /transactions/:id`.
That projection stays off until accepted overwrites are precise.

The agent uses an authenticated finance MCP for scoped reads, historical
examples, category metadata, semantic search, and confirmed household rules.
The dashboard is the review surface. Agent predictions remain proposals until
they are accepted by policy or explicitly confirmed by a household member.

## Problem

The current pipeline categorises Bank Zero rows before posting them to FinWise,
using deterministic rules and a direct Gemini batch request. This does not
provide:

- one owned view of transactions from every account;
- a durable history of classification decisions and corrections;
- semantic retrieval over prior household transactions;
- a review workflow for uncertain or incorrect predictions;
- consistent categorisation improvement for transactions already connected
  through FinWise;
- an evaluation loop that separates source labels, confirmed labels, and model
  predictions.

FinWise’s existing categorisation is an imported baseline, not the owned
decision. The source category stays in the observation. The owned category
lives in Supabase.

## Goals

1. Maintain one relational `accounts` table and one relational `transactions`
   table for all financial sources.
2. Synchronise FinWise-connected accounts into Supabase without overwriting
   owned classifications.
3. Ingest Bank Zero into Supabase before any FinWise write.
4. Store FinWise’s category separately from the owned category.
5. Classify with JEV. Use an agent only when the row is novel or ambiguous.
6. Give the agent read access to relevant prior transactions, category
   definitions, semantic matches, and approved household rules.
7. Provide dashboard review for proposals and corrections.
8. Publish Bank Zero transactions to FinWise only after category selection.
9. Preserve provenance, idempotency, audit history, and evaluation data.
10. Support model experimentation through the Vercel AI Gateway without
    coupling the system to a provider or model.

## Non-goals

- Updating or mutating an existing FinWise transaction category.
- Treating FinWise’s category as the permanent household truth.
- Giving the model unrestricted SQL or unrestricted write access.
- Creating separate tables per account, bank, or provider.
- 22seven. That source is retired and must not be reintroduced.
- Replacing FinWise as a connected-account data source on day one.
- Training or fine-tuning a model as part of the initial implementation.
- Automatically extracting episodic rules from unconfirmed model predictions.
- Rebuilding the existing consumption schema.

Adjacent: a future FinWise transaction-update capability can add a projection
reconciliation path, but it is not required or assumed by this specification.

## Users and outcomes

### Household members

Gustav and Cara need to see one consistent categorisation across all accounts,
review uncertain rows, correct mistakes, and understand why a category was
chosen.

### System operators

The operator needs deterministic imports, safe retries, sync visibility,
reproducible model runs, and a clear distinction between source data and
derived decisions.

### Model evaluator

The evaluator needs to replay hidden transactions through the same tools used
in production, compare predictions against trusted labels, and inspect
retrieval and cost without category leakage.

## Product requirements

### PR-001 — Consolidated account model

The system SHALL represent every financial account in one `accounts` table.
Each account SHALL identify its household, source system, stable source
account ID, display metadata, currency, and lifecycle state.

The system SHALL represent every transaction in one `transactions` table.
Every transaction SHALL reference exactly one account.

### PR-002 — Source coverage

The system SHALL support:

- FinWise-connected accounts, including Easy Equities, Discovery Bank, and
  IBKR;
- manually imported Bank Zero statements;
- additional sources by adding source mappings, not new account-specific
  tables.

### PR-003 — Owned source-of-truth model

Supabase SHALL own the consolidated canonical representation used by the
dashboard, retrieval tools, and owned categorisation.

FinWise transaction facts SHALL be imported as source observations. Bank Zero
facts SHALL be staged from the original statement and normalized into the same
owned model.

### PR-004 — Source and owned categorisation

The system SHALL retain FinWise’s category as an imported source label when it
exists. The system SHALL store the household-owned category separately.

A FinWise sync SHALL never overwrite a user-confirmed or policy-approved owned
category.

### PR-005 — FinWise synchronization

A scheduled server-side job SHALL enumerate and pull accounts, transactions,
and categories from the user’s FinWise account. It must not hardcode a single
account such as Discovery.

The sync SHALL be idempotent, retry-safe, auditable, and scoped to the
household. It SHALL use stable source IDs and an overlap window where the API
does not provide a reliable incremental cursor.

### PR-006 — Bank Zero ingestion

The existing Cloudflare webhook and queue path SHALL parse and validate Bank
Zero statements. Valid rows SHALL be persisted to Supabase before
categorisation and before a FinWise create request.

### PR-007 — Agentic classification

The normal classifier SHALL be the measured JEV worker. An agent SHALL be used
only for the novel or ambiguous tail, not for every row.

The agent SHALL:

1. receive one or more scoped transactions;
2. retrieve relevant context through finance MCP tools;
3. inspect candidate categories;
4. reason over evidence;
5. return schema-validated structured output;
6. abstain when evidence is insufficient.

The model SHALL be selected through Vercel AI Gateway configuration. Provider
API keys SHALL not be stored in application code or exposed to the browser.

### PR-008 — Finance MCP

The system SHALL expose an authenticated finance MCP with narrowly scoped
tools:

- `get_transaction`;
- `search_transactions`;
- `search_similar_transactions`;
- `get_category_catalog`;
- `get_source_finwise_category`;
- `get_confirmed_rules`.

The MCP SHALL enforce household and account scope server-side. It SHALL not
expose unrestricted SQL.

The MCP SHALL query the owned Supabase data for normal agent context. FinWise
API reads SHALL be used for synchronization or reconciliation rather than as
the primary owned memory.

### PR-009 — Classification proposal

Every agent run SHALL produce a proposal containing at least:

- transaction ID;
- candidate owned category ID or explicit abstention;
- confidence;
- `needs_review`;
- evidence transaction IDs;
- model identifier;
- prompt/instruction version;
- agent run ID.

Agent output SHALL be validated against the owned category catalogue before
being persisted.

### PR-010 — Dashboard review

The dashboard SHALL show pending proposals with:

- transaction facts;
- current FinWise source category, if any;
- proposed owned category;
- confidence;
- evidence transactions;
- alternatives where available;
- approval, rejection, and correction actions.

Dashboard writes SHALL go through authenticated server-side operations. The
browser SHALL never receive FinWise or Supabase service credentials.

### PR-011 — FinWise projection

Bank Zero transactions SHALL be created in FinWise only after a category is
final under the configured policy or after dashboard approval.

The publish operation SHALL use the FinWise create endpoint and record the
returned FinWise transaction ID.

For connected FinWise transactions, owned categorisation SHALL remain local to
Supabase. The system SHALL not attempt a category update that FinWise does not
support.

### PR-012 — Semantic retrieval

The system SHALL maintain embeddings for the normalized transaction text used
by retrieval. Embeddings SHALL be versioned and tied to an input content hash.

Confirmed classifications SHALL be preferred as labelled examples. Agent
predictions SHALL not become trusted examples without confirmation.

### PR-013 — Evaluation

The system SHALL support shadow-mode evaluation using the existing raw and
hidden transaction dumps.

Evaluation retrieval SHALL exclude:

- the target transaction;
- the target’s hidden category;
- transactions that occur after the target when testing historical
  generalization.

The evaluation SHALL report exact accuracy, top-k accuracy, abstention quality,
correction rate, latency, and token cost.

## End-to-end flows

### FinWise-connected account sync

```text
FinWise API
  → scheduled sync
  → source identity upsert
  → source observations and source category snapshot
  → Supabase transaction row
  → optional classification proposal
```

The sync may update source-owned fields. It must preserve owned decisions.

### Bank Zero import

```text
SendGrid
  → Cloudflare ingest Worker
  → R2 and Queue
  → parser and validator
  → Supabase staged transaction
  → classification Workflow
  → JEV classifier
  → owned category and treatment
  → FinWise POST with category
  → publication mapping
```

Low-confidence rows stop at `pending_review`. They remain in Supabase until
approved, rejected, or corrected.

### Reclassification of connected transactions

```text
Supabase transaction
  → classification Workflow
  → JEV classifier
  → owned category and treatment
  → optional FinWise category projection
```

The original FinWise category remains visible as source metadata.

## Acceptance criteria

### AC-001 — Unified relational model

- **Given** accounts from FinWise and Bank Zero,
- **When** they are loaded,
- **Then** all accounts exist in one `accounts` table and all transactions
  exist in one `transactions` table with valid account foreign keys.
- **Check:** schema migration review and integration test.

### AC-002 — Idempotent source sync

- **Given** the same FinWise sync window is run twice,
- **When** both runs complete,
- **Then** no duplicate account or transaction identities exist and the second
  run does not alter owned classification decisions.
- **Check:** sync integration test and unique-constraint verification.

### AC-003 — Pre-create Bank Zero classification

- **Given** a valid Bank Zero transaction,
- **When** the import pipeline processes it,
- **Then** the transaction is staged in Supabase before any FinWise POST and the
  POST includes the final selected category.
- **Check:** workflow integration test with ordered test doubles.

### AC-004 — Review hold

- **Given** an agent proposal below the auto-approval policy,
- **When** classification completes,
- **Then** the transaction remains unpublished to FinWise and appears as a
  dashboard review item.
- **Check:** end-to-end review test.

### AC-005 — Connected-account overlay

- **Given** a FinWise transaction with an existing source category,
- **When** the agent proposes a different owned category,
- **Then** both values remain available in Supabase and the source category is
  not overwritten.
- **Check:** sync/reclassification integration test.

### AC-006 — Agent tool loop

- **Given** a transaction requiring context,
- **When** the classifier runs,
- **Then** JEV returns a schema-valid category or an explicit abstention. An
  escalation agent may call scoped MCP tools only for that unresolved tail.
- **Check:** agent contract test with mocked MCP responses.

### AC-007 — Review authorization

- **Given** an unauthorised dashboard user,
- **When** they request or mutate financial review data,
- **Then** the operation is rejected by authentication/RLS and no financial
  data is returned.
- **Check:** RLS and route authorization tests.

### AC-008 — Evaluation isolation

- **Given** a hidden evaluation transaction,
- **When** the agent searches for evidence,
- **Then** the target row and future labelled rows are excluded from retrieval.
- **Check:** deterministic retrieval test.

## Success measures

Initial success is operational rather than a fixed accuracy target:

- every configured account is represented in Supabase;
- repeated syncs do not create duplicates;
- no owned classification is lost during sync;
- every new Bank Zero row has a visible lifecycle state;
- every model decision is reproducible from its run metadata;
- reviewer corrections become usable labelled examples;
- model accuracy and abstention can be measured against a held-out set.

## Rollout

1. Inventory deployed finance tables and protect existing readers.
2. Add canonical identity, source, and owned-classification fields/tables.
3. Backfill FinWise accounts, transactions, categories, and source labels.
4. Build the scheduled FinWise-to-Supabase sync.
5. Change Bank Zero to stage in Supabase before FinWise creation.
6. Build finance MCP read tools and semantic indexing.
7. Run JEV in shadow, writing owned decisions to Supabase and not to FinWise.
8. Add dashboard proposal review and correction capture.
9. Enable high-confidence Bank Zero publishing.
10. Reclassify connected-account history in batches, starting with proposals.

## Constraints and risks

- Financial schema migrations require human review and a tested rollback plan.
- Service-role keys and FinWise keys must remain server-side.
- FinWise’s lack of transaction updates means Supabase and FinWise categories
  can intentionally diverge.
- Source APIs may revise pending transactions; source observations and
  idempotency must handle revisions.
- AI output is probabilistic. The system must support abstention and review.
- Semantic retrieval can leak labels during evaluation unless temporal and
  target exclusion rules are enforced.
- The current direct Gemini categorisation path must be retired or explicitly
  disabled to avoid two competing classification systems.
