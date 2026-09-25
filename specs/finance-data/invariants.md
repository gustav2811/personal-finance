# Finance Database Invariants

Status: draft
Parent: [Owned Finance Data and Agentic Categorisation](README.md)
Applies to: canonical accounts, transactions, categories, sync, classification,
review, and FinWise publication

These are correctness rules, not implementation suggestions. A migration,
ingestion adapter, API route, MCP tool, agent, or dashboard action must preserve
them. Each invariant is labelled:

- **DB** — enforce with PostgreSQL constraints, foreign keys, indexes, RLS, or
  triggers wherever possible.
- **Service** — enforce in a transaction or workflow and cover with tests.
- **Review** — requires an explicit human decision or operational check.

## Definitions

- **Source fact:** a value observed from FinWise, Bank Zero, or another
  registered provider.
- **Owned fact:** a value chosen and maintained by this household in Supabase.
- **Source identity:** `(household_id, account_id, source_system,
  source_transaction_id)`.
- **Owned classification:** the household category assigned to a transaction.
- **Confirmed classification:** an owned classification accepted by a person or
  an explicitly approved deterministic policy.
- **Projection:** a write from owned data to a provider such as FinWise.

## Ownership and access

### INV-OWN-001 — Every financial row has an owner

Every account, balance snapshot, transaction, source category, owned category,
classification, proposal, embedding, agent run, feedback record, and episodic
rule SHALL reference exactly one household.

- **Enforcement:** `NOT NULL` plus foreign key to `households`.
- **Class:** DB.

### INV-OWN-002 — Account and transaction ownership agrees

A transaction or balance snapshot’s `household_id` SHALL equal its account’s
`household_id`.

- **Enforcement:** composite foreign key
  `(account_id, household_id) → accounts(id, household_id)` on each dependent
  table, or an equivalent constraint trigger.
- **Class:** DB.

### INV-OWN-003 — Related classification ownership agrees

A classification, proposal, embedding, feedback record, or agent run SHALL
reference only a transaction from the same household. A classification SHALL
reference only a category from the same household.

- **Enforcement:** composite foreign keys or constraint triggers.
- **Class:** DB.

### INV-OWN-004 — Database access follows household membership

Authenticated reads and writes SHALL be permitted only when the caller is an
active member of the row’s household and has the required role.

- **Enforcement:** Supabase RLS on every finance table, with explicit policies
  for `authenticated`; no client service-role key.
- **Class:** DB.

### INV-OWN-005 — Service credentials remain server-side

FinWise credentials, AI Gateway credentials, and Supabase service-role
credentials SHALL never be sent to the browser, embedded in bundles, or stored
in source control.

- **Enforcement:** deployment configuration, secret scanning, route tests.
- **Class:** Service.

### INV-OWN-006 — Raw financial payloads are least-privilege data

Raw statements and provider payloads may contain more personal data than the
dashboard or agent needs. Normal reads SHALL return the minimum typed fields
needed for the operation. Raw payload access requires an explicitly privileged
server-side path.

- **Enforcement:** separate repository methods, RLS policy, response schemas.
- **Class:** DB / Service.

### INV-OWN-007 — Test data is isolated

Production financial payloads SHALL not be copied into tests, logs, local
fixtures, or evaluation datasets unless they are explicitly approved and
sanitized for that purpose.

- **Enforcement:** fixture review, environment separation, secret/data scanning.
- **Class:** Service / Review.

## Stable identity and deduplication

### INV-ID-001 — Internal IDs are not source IDs

Each row SHALL have an internal stable ID. External provider IDs SHALL be
stored separately as text and SHALL NOT be used as the universal primary key.

- **Enforcement:** schema design and migration review.
- **Class:** DB.

### INV-ID-002 — Account source identity is unique

Within a household, `(source_system, source_account_id)` SHALL identify at most
one logical account.

- **Enforcement:** unique constraint.
- **Class:** DB.

### INV-ID-003 — Transaction source identity is unique

Within a household, `(account_id, source_system, source_transaction_id)` SHALL
identify at most one canonical transaction.

- **Enforcement:** unique constraint.
- **Class:** DB.

### INV-ID-004 — Source identity does not change

After a source identity is persisted, an adapter SHALL not change it to repair
a duplicate or merge. A suspected merge requires an explicit reconciliation
record.

- **Enforcement:** update policy, audit log, migration review.
- **Class:** Service / Review.

### INV-ID-005 — Display values are not identity

Account names, descriptions, merchant names, dates, amounts, and categories
SHALL never be used alone as deduplication keys.

- **Enforcement:** adapter contract and code review.
- **Class:** Service.

### INV-ID-006 — FinWise publication identity is unique

When a FinWise transaction ID is known, it SHALL map to at most one household
transaction. A Bank Zero source row and its FinWise projection remain one
canonical transaction, not two transactions.

- **Enforcement:** partial unique constraint on
  `(household_id, finwise_transaction_id)`.
- **Class:** DB.

### INV-ID-007 — Balance observations are unique

One account SHALL have at most one balance snapshot for a source and
`as_of_at` instant.

- **Enforcement:** unique constraint on
  `(household_id, account_id, source_system, as_of_at)`.
- **Class:** DB.

### INV-ID-008 — Source category identities are unique

Within a household and source system, one source category ID SHALL map to at
most one current source-category row.

- **Enforcement:** unique constraint on
  `(household_id, source_system, source_category_id)`.
- **Class:** DB.

## Source preservation and provenance

### INV-SRC-001 — Raw source evidence is retained

Every imported transaction SHALL retain the source payload, source system,
source identity, retrieval time, and sync-run ID or equivalent provenance.

- **Enforcement:** non-null provenance fields and raw payload storage.
- **Class:** DB / Service.

### INV-SRC-002 — Normalization is loss-aware

Normalization MAY add typed fields, normalized merchant text, or derived
direction. It SHALL NOT discard the original description, amount, date, source
category, or payload.

- **Enforcement:** adapter tests and source/typed-field review.
- **Class:** Service.

### INV-SRC-003 — Source observations are auditable

When a provider revises a transaction, the latest canonical source fields MAY
change, but prior raw observations or a content-hash-linked audit record SHALL
remain recoverable.

- **Enforcement:** append-only observation/event table or equivalent immutable
  object storage.
- **Class:** Service.

### INV-SRC-004 — Source and owned fields are separate

A source sync SHALL update only source-owned fields. It SHALL never overwrite
owned category, confirmed classification, reviewer decision, feedback, or
approved episodic rules.

- **Enforcement:** separate write repository methods, column allowlists, and
  sync integration tests.
- **Class:** Service.

### INV-SRC-005 — Source labels are snapshots, not foreign truth

FinWise category IDs and names SHALL be stored as source metadata. A deleted,
renamed, or reordered FinWise category SHALL not invalidate historical owned
classifications.

- **Enforcement:** source category snapshot fields and separate owned category
  foreign key.
- **Class:** DB / Service.

### INV-SRC-006 — Source systems are registered

`source_system` values SHALL come from an allowlisted source registry with a
defined adapter and identity contract. An arbitrary string must not silently
create a new ingestion namespace.

- **Enforcement:** reference table or check constraint plus adapter registry.
- **Class:** DB / Service.

## Monetary and temporal correctness

### INV-MONEY-001 — Monetary values are exact

Amounts SHALL use PostgreSQL `numeric`/`decimal` with an explicitly chosen
scale. Application code SHALL not use binary floating point for persistence,
comparison, reconciliation, or aggregation.

- **Enforcement:** column type, money utility tests, lint/review.
- **Class:** DB / Service.

### INV-MONEY-002 — Currency is explicit

Every monetary transaction and balance SHALL have a non-null ISO currency code.
Currency SHALL not be inferred from account display names or provider labels.

- **Enforcement:** `NOT NULL` and format check constraint.
- **Class:** DB.

### INV-MONEY-003 — Amount sign has one documented meaning

The canonical sign convention SHALL be consistent across all adapters. The
recommended convention is positive inflow/credit and negative outflow/debit.
Provider-specific signs must be normalized once at ingestion.

- **Enforcement:** adapter contract and fixture tests.
- **Class:** Service.

### INV-MONEY-004 — Conversion is explicit

A value in one currency SHALL not be silently converted into another. Any
converted amount must retain source amount, source currency, target currency,
rate, rate timestamp, and conversion source.

- **Enforcement:** schema and reporting-query review.
- **Class:** DB / Service.

### INV-TIME-001 — Event time and ingestion time are distinct

The transaction’s source event time SHALL be stored separately from
`created_at`, `updated_at`, `source_seen_at`, and sync-run time.

- **Enforcement:** separate columns and adapter tests.
- **Class:** DB.

### INV-TIME-002 — Time zones are not silently changed

Timestamp values SHALL be stored with timezone semantics or as a source-local
date when the provider supplies only a date. Adapters SHALL preserve the
provider’s timezone/date interpretation.

- **Enforcement:** `timestamptz`/`date` choice and boundary tests.
- **Class:** DB / Service.

### INV-TIME-003 — Historical facts are not moved by re-sync

A repeated sync SHALL not change a transaction’s event time merely because the
sync window or local timezone changed. A source correction must be represented
as a source revision.

- **Enforcement:** update allowlist and regression test.
- **Class:** Service.

## Transaction lifecycle and deletion

### INV-LIFE-001 — Lifecycle values are constrained

Account, transaction, proposal, classification, sync, and publication states
SHALL use constrained values or dedicated lookup types. Arbitrary status
strings are not allowed.

- **Enforcement:** PostgreSQL enum/check constraint or reference table.
- **Class:** DB.

### INV-LIFE-002 — Source archive is not owned deletion

An archived or missing source row SHALL not be hard-deleted from the owned
dataset. It may be marked with source/archive state.

- **Enforcement:** soft-delete/archive policy and delete restrictions.
- **Class:** Service.

### INV-LIFE-003 — Financial history is append-preserving

Correction, merge, split, publication, and classification actions SHALL leave
an audit trail. Hard deletion requires an explicit data-governance decision and
must not be the default repair path.

- **Enforcement:** append-only history, restricted delete privileges.
- **Class:** Service / Review.

### INV-LIFE-004 — Publication state is truthful

A transaction SHALL not be marked `published` unless a successful FinWise
create response has been recorded and linked to its FinWise transaction ID.

- **Enforcement:** publication transaction and state transition guard.
- **Class:** DB / Service.

### INV-LIFE-005 — FinWise updates are never assumed

No workflow may depend on changing an existing FinWise transaction category.
For manually imported data, category selection occurs before the FinWise
create. For connected data, improved categories remain local to Supabase.

- **Enforcement:** architecture boundary, API client surface, integration test.
- **Class:** Service.

## Idempotency and synchronization

### INV-SYNC-001 — Replaying a source page is safe

Processing the same source page, statement, webhook, or sync window multiple
times SHALL not create duplicate accounts, transactions, proposals, or FinWise
publications.

- **Enforcement:** source identity unique constraints and idempotency keys.
- **Class:** DB / Service.

### INV-SYNC-002 — Retries use the same identity

A retry SHALL reuse the original source identity, import ID, and publication
idempotency key. It SHALL not generate a new transaction identity.

- **Enforcement:** persisted ingest envelope and workflow tests.
- **Class:** Service.

### INV-SYNC-003 — Sync completeness is explicit

A sync SHALL record its requested window, source accounts, counts, status, and
errors. A partial failure SHALL not be reported as a successful complete sync.

- **Enforcement:** `sync_runs` state machine and run-level checks.
- **Class:** DB / Service.

### INV-SYNC-004 — Overlap windows are reconciled

Where a source has no reliable cursor, syncs SHALL reread an overlap window and
upsert by stable source identity. The overlap window SHALL be documented and
large enough to cover expected pending-to-posted revisions.

- **Enforcement:** sync configuration and integration test.
- **Class:** Service.

### INV-SYNC-005 — Unknown accounts do not create orphan rows

A transaction for an unmapped source account SHALL be quarantined or reported
for account mapping. It SHALL not be inserted with a guessed account or null
foreign key.

- **Enforcement:** foreign key and quarantine path.
- **Class:** DB / Service.

## Classification integrity

### INV-CLASS-001 — Category belongs to the taxonomy

Every owned classification SHALL reference an existing, active or historically
valid household category. A model-generated arbitrary category string is not a
valid classification.

- **Enforcement:** foreign key, category validation, agent output schema.
- **Class:** DB / Service.

### INV-CLASS-002 — One active confirmed category

A transaction SHALL have zero or one active confirmed owned classification, never
two competing current categories.

- **Enforcement:** partial unique index on transaction and active-confirmed
  status.
- **Class:** DB.

### INV-CLASS-003 — Classification history is append-only

A new decision SHALL supersede or reject the previous decision through a new
history row. Existing decision rows SHALL not be edited to hide what happened.

- **Enforcement:** update trigger/privilege separation and service repository.
- **Class:** DB / Service.

### INV-CLASS-004 — Confidence has a bounded meaning

Any confidence value SHALL be numeric, non-null when supplied, and within
`0 <= confidence <= 1`. Confidence is not proof of correctness and must not
automatically bypass review without a configured policy.

- **Enforcement:** check constraint and policy configuration.
- **Class:** DB / Service.

### INV-CLASS-005 — Abstention is valid

The classifier SHALL be able to return no category, `needs_review = true`, or
an equivalent abstention. The system must not force an arbitrary category to
complete a workflow.

- **Enforcement:** nullable proposal category plus state rules.
- **Class:** DB / Service.

### INV-CLASS-006 — Model output is validated

The agent output SHALL be parsed against a schema and checked against the
current category catalogue before persistence. Invalid output is a failed run,
not a best-effort write.

- **Enforcement:** structured-output validator and contract test.
- **Class:** Service.

### INV-CLASS-007 — Predictions are not labels

An agent proposal SHALL not be used as a trusted training/evaluation label or
as an approved episodic rule until a person or explicitly approved policy
confirms it.

- **Enforcement:** `decision_source`, status, and retrieval filters.
- **Class:** Service.

### INV-CLASS-008 — User corrections win

A confirmed user correction SHALL supersede an agent proposal and remain
effective across source re-syncs and later agent runs unless the user changes
it again.

- **Enforcement:** decision precedence and sync write allowlist.
- **Class:** DB / Service.

### INV-CLASS-009 — Classification rationale is reproducible

Every agent proposal SHALL reference the agent run, model ID, prompt/instruction
version, tool evidence IDs, and category catalogue version used to produce it.

- **Enforcement:** non-null audit fields for agent decisions.
- **Class:** DB / Service.

### INV-CLASS-010 — Review actions are authenticated and immutable

Every approve, reject, or correct action SHALL identify an authenticated
reviewer and SHALL remain available as an immutable feedback record. A UI
retry must not create two effective decisions.

- **Enforcement:** reviewer foreign key, append-only feedback table, idempotency
  key on the review command.
- **Class:** DB / Service.

## Transfers, splits, and aggregation

### INV-AGG-001 — Non-recognition movement is not income or spend

An internal movement leg that is not the event's economic-recognition leg
SHALL not be counted as household income or spend. Exclusion comes from the
owned treatment and event role, not from `category = 'Transfers'`.
`Housekeeping` funding is recognised once on the outflow. `Investments` may
carry a transfer flag when the leg is an internal conversion. The legs of one
event must be linked when both are known.

- **Enforcement:** `transaction_treatments` and `financial_event_legs`, plus
  reporting queries that filter on `exclude_from_spend` and `leg_role`.
- **Class:** Service.

### INV-AGG-002 — Split allocations reconcile

If a transaction is split, the signed sum of child allocations SHALL equal the
parent transaction amount in the same currency. Rounding differences require an
explicit, bounded residual policy.

- **Enforcement:** deferred constraint trigger or transactional validation.
- **Class:** DB / Service.

### INV-AGG-003 — A transaction is not double-counted

A report SHALL choose one representation: unsplit parent or complete child
allocations. It must not aggregate both.

- **Enforcement:** reporting views and fixture tests.
- **Class:** Service.

### INV-AGG-004 — Unknown is not zero

Missing category, missing merchant, or failed enrichment SHALL remain unknown.
It must not be converted into zero amount, excluded silently, or assigned to a
catch-all category without an explicit policy.

- **Enforcement:** nullable fields, report tests, review.
- **Class:** Service / Review.

## Agent, memory, and retrieval integrity

### INV-AI-001 — MCP access is scoped

Every finance MCP request SHALL be authorized to one household and SHALL apply
that scope in the database query. Tool arguments cannot widen the scope.

- **Enforcement:** server-side auth context and negative authorization tests.
- **Class:** Service.

### INV-AI-002 — Agent has no unrestricted database access

The agent SHALL use allowlisted MCP tools. It SHALL not receive service-role
credentials or execute arbitrary SQL.

- **Enforcement:** MCP surface and deployment configuration.
- **Class:** Service.

### INV-AI-003 — Retrieval evidence is same-household

Every transaction returned as agent evidence SHALL belong to the current
household. Evidence IDs SHALL be persisted with the proposal.

- **Enforcement:** RLS, scoped query, evidence validation.
- **Class:** DB / Service.

### INV-AI-004 — Embeddings are derived and versioned

An embedding SHALL reference its transaction, embedding model/version, input
content hash, and creation time. It may be deleted and rebuilt without losing
financial facts.

- **Enforcement:** foreign key, unique `(transaction_id, embedding_version)`,
  content-hash comparison.
- **Class:** DB / Service.

### INV-AI-005 — Evaluation has no target leakage

Evaluation retrieval SHALL exclude the target transaction, its hidden label,
and future trusted labels when evaluating historical generalization.

- **Enforcement:** evaluation query parameters and deterministic tests.
- **Class:** Service.

### INV-AI-006 — Episodic memory requires approval

Only explicitly approved household rules may influence production retrieval as
episodic memory. Raw model reasoning, rejected proposals, and unreviewed
feedback are not production rules.

- **Enforcement:** rule status and MCP filter.
- **Class:** Service / Review.

### INV-AI-007 — Tool failures fail closed

If required category or evidence tools fail, the agent SHALL abstain or place
the transaction in review. It must not invent categories or silently proceed
with stale unmarked context.

- **Enforcement:** agent workflow state machine and failure tests.
- **Class:** Service.

## Operational and audit integrity

### INV-OPS-001 — Every workflow has a correlation ID

Webhook, queue message, sync run, workflow, agent run, proposal, and FinWise
publication logs SHALL be joinable through stable correlation IDs.

- **Enforcement:** structured logging and persisted run metadata.
- **Class:** Service.

### INV-OPS-002 — Logs do not leak secrets

Logs SHALL not contain API keys, access tokens, raw statement contents, or
unnecessarily complete financial descriptions. Logs should use IDs, counts,
statuses, and bounded diagnostic context.

- **Enforcement:** logger wrapper, redaction, log review.
- **Class:** Service / Review.

### INV-OPS-003 — Errors are durable

A failed parse, sync, classification, review mutation, or FinWise publication
must leave a durable failure state that can be inspected and retried safely.

- **Enforcement:** workflow state, `sync_runs`, proposal/run errors, DLQ or
  equivalent.
- **Class:** Service.

### INV-OPS-004 — Migrations are reversible or recoverable

Every finance schema migration SHALL have a backup/export, validation queries,
row-count reconciliation, and a documented rollback or forward-repair plan.

- **Enforcement:** migration checklist and review gate.
- **Class:** Review.

## Enforcement checklist

Before implementation is marked complete:

- [ ] Unique source identity constraints exist.
- [ ] Household ownership and cross-household foreign keys exist.
- [ ] RLS is enabled and negative authorization tests pass.
- [ ] Amount and currency constraints exist.
- [ ] Source and owned category columns are separate.
- [ ] Active-confirmed classification uniqueness exists.
- [ ] Classification history cannot be silently rewritten.
- [ ] Sync write allowlists preserve owned fields.
- [ ] FinWise publication is create-only and idempotent.
- [ ] Proposal output is schema- and catalogue-validated.
- [ ] Evidence retrieval is household-scoped and evaluation-safe.
- [ ] Embeddings carry input hashes and versions.
- [ ] Failures are durable and retry-safe.
- [ ] Migration reconciliation and recovery steps are documented.
