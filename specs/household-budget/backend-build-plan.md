# Backend build plan

Prepared 2026-09-30. Status: local verification foundation prepared in PR #36;
additive budget schema prepared in stacked PR #37; command API prepared in #38;
funding, bank allocations and initial reads are prepared in stacked PR #41;
source drift, pending exposure and completeness are prepared in the stage 3 follow-up.
No production migration, deployment or financial
activation performed.

Execution update: the first PR contains local database replay and security tests.
Per the household's 2026-09-30 instruction, keep `pr.yml` and `deploy.yml` unchanged;
database tests run locally. Pause after preparing each PR and await the user's
instruction before starting the next stage. No new deployment/provenance gate.

The first schema follow-up contains packet B only: tables, tenant constraints,
immutable-history guards and local tests. Split the original PR 1 into schema
(1a) and plan/configuration/reconciliation commands (1b) to keep review bounded.
The user authorized the command packet on 2026-09-30. Its six RPCs cover fund
creation/rename, draft replacement/publication, account settings and audited
reconciliation. The precise manifest is [command API execution contract](command-api-contract.md).
The user authorized stage 2 on 2026-10-01: funding, reviewed bank allocations and
initial member reads, stacked on #38. Its precise manifest is the
[funding API execution contract](funding-api-contract.md). Pause after preparing
this PR; source exposure, restricted claims and remaining queries need separate
instructions before their stages start.

The user authorized stage 3 on 2026-10-01, stacked on #41. Its executable
manifest is the [source-state execution contract](source-state-api-contract.md).
Pause after preparing that PR; restricted claims/utility recognition and the final
query/runbook stage still require separate instructions.

Stage 3 verification on 2026-10-05 passed a fresh disposable migration replay,
all 1,007 pgTAP assertions across 14 suites, and nine overlapping command/source
races. Independent correctness/security review closed without outstanding P1/P2
findings. SQL function lint found no errors; warnings include existing validation
helper volatility annotations and implicit JSON-key casts. The public read
acceptance covers known/unknown pending purpose, balance inclusion, posting,
confirmed purchase mirrors, conservative reviewed-source drift, and tenant access.
The stage 3 PR is stacked on #41; execution pauses before stage 4.

Stage 2 verification on 2026-10-01 passed a fresh migration replay, all 872
pgTAP assertions across 11 suites and five overlapping command races. The
funding, allocation and read migrations also received an independent correctness
and security review. Local verification leaves the existing release workflows
unchanged.

## Objective and authority

Deliver the household-budget database, transactional commands and member-facing
read queries specified in [data and delivery](data-and-delivery.md) and
[behaviour](behaviour.md). Those documents govern product behaviour; this plan
governs execution, ownership and release gates. Use [experience](experience.md)
only to establish the data the future dashboard needs. Build no dashboard routes,
components, charts or screens during this programme.

First working slice: using explicitly synthetic local observations, create and
publish a complete plan, reconcile resources, assign a persistent fund, review
Cara's shared purchase and query the resulting fund balance and actual payer.
Demonstrate this through member RPCs and integration tests.

Production migrations and deployments must originate in reviewed PRs. Local,
disposable database replay and test fixtures are development activities. No
linked-database DDL/DML, MCP apply_migration, manual Worker deployment or direct
trunk push is part of execution. Financial activation has its own evidence gate.

## Verified starting point

Read-only inspection on 2026-09-30 established:

- Repository trunk is `master`. Local design commit `ee87307` is one commit ahead
  of `origin/master`; preserve it in the initial PR ancestry. Planning branch is
  `feature/household-budget-backend-plan`.
- Supabase `finance-data` is PostgreSQL 17. All 30 checked-in migration versions
  match the deployed migration list. This verifies history, not full schema parity.
- `public.transactions.id` is text; `public.accounts.account_id` is UUID.
  Transaction amounts are numeric and require explicit normalization to ZAR cents.
- `public.snapshots` has primary key `(account_id, date)`, numeric `amount_cents`,
  optional `observed_at`, currency and household. It has no snapshot UUID and is
  not intrinsically immutable. A reconciliation must freeze the inspected values
  and detect replacement of the referenced observation.
- Membership uses `finance.household_members.id` for a household person and
  `auth_user_id` for authentication. Extend the latest household resolver and
  verified identity policy; do not revive the older email-only policy.
- Classifications, treatments, source observations and financial events exist.
  No reusable command-receipt or budgeting table was found in public/finance.
- Consumption devices and ledger entries have UUID IDs but no household column.
  Financial-event legs currently reference bank transactions only.
- PR CI runs a linked migration dry-run. Deployment runs on pushes to `master`
  and applies migrations before Workers. Preserve this existing release process.
- No checked-in `supabase/config.toml` exists. Migration history assumes the
  original public finance tables already exist. The installed shell has no
  Supabase CLI on PATH. Establish a pinned local test runtime in PR 0.
- Existing `supabase/tests/household_isolation.sql` reports success by deliberate
  exceptions. It is not a conventional passing pgTAP suite; preserve its coverage
  while converting it into an automated runner with real pass/fail semantics.

Do not refresh the spreadsheet or FinWise merely to repeat the design research.
Refresh those bounded sources when preparing the real draft/cutover. Metadata
checks above read no individual transaction, balance or salary values.

## Primary-agent decisions

The primary owns design interpretation, SQL contracts, financial semantics,
dependency order, integration, review resolution and PR preparation. Builders
implement bounded contracts and tests; they return ambiguities rather than make
financial or architectural decisions.

Use two `mozart` builders (LUNA) for scoped schema/query/test work and one
`beethoven` builder (TERRA) for transactional commands and source integration.
Dispatch at most three builders at once. Run a `clara_schumann` correctness and
security review after integration; it may identify defects, not rewrite the design.
The primary determines fixes and assigns them. Reuse agents across work packets.

Every dispatch includes the common brief below and a parent-frozen manifest of
actual filenames, SQL signatures, JSON fields, constraints and acceptance tests.
This plan defines the intended API names and semantics. The parent freezes their
executable payload schemas before dispatching dependent builders. Never ask a
builder to invent a missing contract. Keep dependency work sequential; parallelize
only tasks whose files and contracts are independent.

### Concrete database decisions

1. Place the nine business tables in `finance`. New monetary columns are bigint
   ZAR cents. Return cents as decimal strings in JSON to avoid JavaScript precision
   loss. New entity IDs and command IDs are UUIDs. Source transaction IDs stay text.
2. Represent a person by `household_members.id`, not email, display name or auth UID.
   Shared beneficiary/owner uses an explicit scope plus a null person reference;
   member scope requires a same-household person reference. Actor identity comes
   from the authenticated resolver and cannot be supplied by the client.
3. Use same-household composite references `(household_id, id)` or
   `(household_id, account_id)` wherever possible. Add the necessary referenced
   unique indexes to existing finance/source tables in additive migrations. Reject
   null/mismatched household on canonical sources; do not silently claim them.
   Use RESTRICT/NO ACTION for monetary history, never cascading deletion.
4. Add one operational table, `finance.budget_commands`, alongside the nine
   business tables. Key `(household_id, command_id)`; store command kind, canonical
   validated JSON payload, actor, completion timestamp and exact result. Include
   before/after account-setting facts in the receipt for their audit trail. This
   is a demonstrated retry/audit requirement, not a new money journal. Failed
   commands roll back the receipt. Replay of the same normalized payload returns
   the committed result; reuse with a different kind or payload fails.
5. Published headers/lines, source snapshots, reconciliation evidence, allocation
   components, movements, earmarks and completed receipts are immutable. Lifecycle
   changes to allocation-set status are allowed only inside controlled commands;
   monetary corrections append/supersede. Draft editing uses an explicit revision
   token. Account settings are mutable only through audited commands.
6. An allocation source is exactly one bank transaction or utility entry, with
   revision number distinct from a budget version. Partial source uniqueness covers
   both `current` and `needs_review`, so a stale set retains its existing effect.
   Superseded sets remain inspectable and contribute no current effect.
7. Reconciliation JSON uses schema version 1 with an explicit cutoff, expected
   account inventory, owner/settings snapshot, observation key and value, currency,
   source timestamp, balance convention, normalized cash/debt, pending inclusion
   evidence and verified restricted eligibility. Missing information remains
   missing. Do not coerce missing debt, ownership or currency to zero/defaults.
8. Lock `finance.households` first for every monetary command, then source/fund/
   restricted-account rows in deterministic ID order. A single-household workload
   makes this simple serialization acceptable. Publication and settings changes
   use the same household lock. Re-read source/reconciliation fingerprints under
   the lock before mutation. Cross-row conservation checks run at commit or in
   command validation with direct DML unavailable; row-local rules use CHECK/FKs.
9. Public RPC wrappers infer household from the caller and do not accept arbitrary
   household/actor arguments. Internal helpers live in `finance`; use invoker
   queries where possible. Definer write wrappers are a bounded exception to allow
   command-only writes: fixed safe search_path, qualified names, explicit caller
   checks, no dynamic client SQL, revoke PUBLIC/anon EXECUTE, grant authenticated
   deliberately. New private helpers have no public EXECUTE grants. Test actual
   Data API exposure and minimum grants; do not assume schema finance is exposed.
10. Pure reads use a stable, single-statement snapshot and membership checks without
    calling the volatile binding resolver during that statement. Bind identity
    through the existing membership path first. Incomplete/provisional state is
    part of the response contract and controls whether a funding command succeeds.

## Release sequence

| PR | Deliverable | Entry dependency | Exit gate |
| --- | --- | --- | --- |
| 0 | Replayable DB and local fixture harness; accepted design included | Current checkout | Clean replay and meaningful local database assertions |
| 1a | Nine business tables, command receipts and database history guards | PR 0 | Tenant constraints, immutable history and local schema tests pass |
| 1b | Draft/publication and account configuration/reconciliation commands | PR 1a | Stale-edit, command replay and reconciliation tests pass |
| 2 | Fund commands, reviewed bank allocations and first working read slice | PR 1b | Shared payer, accumulation, split/refund, card and concurrent assignment fixtures pass |
| 3 | Source drift, pending identity/exposure and completeness engine | PR 2 | No double deductions; stale/unknown facts prevent confident funding |
| 4 | Atomic restricted claims and household-safe utility recognition | PR 3 | Mortgage/notice/wallet examples and linked correction tests pass |
| 5 | Complete dashboard query contracts and cutover runbook | PR 4 | All specification acceptance cases mapped to passing tests; query/security review complete |

PRs 1–2 can deploy additive schema/RPCs without activating a real budget. Until
PR 3, detected pending activity, source drift or unreconciled post-observation
activity must make availability incomplete and block funding. Until PR 4,
restricted resources and utility-dependent availability stay unverified/excluded.
No transitional release may silently return a confident partial household total.

Prefer these ordered PRs over one large migration. Split a PR further if its
review cannot remain bounded. Do not merge or deploy a dependent PR before its
predecessor is merged, successful and schema history checked.

## Work packets

### A — reproducible local database verification (LUNA)

**Own:** `supabase/config.toml`, `supabase/tests/bootstrap/`, a dedicated
`supabase/tests/database/` pgTAP suite and `tools/budget-db-tests/`.
Leave `.github/workflows/pr.yml` and `.github/workflows/deploy.yml` unchanged.

**Objective:** a fresh disposable database can reproduce the existing finance
schema and run assertion tests without production credentials or financial data.

- Primary first provides a schema-only bootstrap for the pre-migration public
  accounts/transactions/snapshots dependencies, verified against live DDL. Apply
  it locally before replaying chronological migrations; keep it outside production
  migration paths. Never renumber or edit already-applied migration files.
- Configure PostgreSQL 17 parity and pin the runtime image. Discover CLI commands
  through help. Run the local suite for migration, command and query changes.
- Convert isolation coverage into pgTAP: two households, both member identities,
  outsider, anonymous and service-role rejection on member-only commands. Use
  synthetic emails and stable fixture UUIDs, transaction rollback for SQL tests.
- Rebuild from scratch, lint finance/public/consumption, run tests and exercise
  upgrade from the baseline. Add a separate multi-connection concurrency runner.
- Local replay uses no production credentials. Retain the existing linked PR
  dry-run and production deployment pipeline without changing their workflows.
- Record local database verification in each PR description. All migration and
  deployment changes still go through reviewed PRs using the existing process.

**Acceptance:** clean replay succeeds twice and a deliberate SQL assertion failure
makes the local runner exit nonzero. Preserve no real fixture data in Git.
This packet creates no production budgeting migration or workflow change.

### B — schema and tenant constraints (TERRA)

**Own:** one parent-reserved migration for the nine business tables and receipts,
`supabase/tests/database/budget_schema.test.sql`, and schema contract documentation.

**Objective:** encode the agreed facts and immutable boundaries, ready for commands.

- Implement every field in data-and-delivery with concrete types/defaults/nullability
  in the frozen manifest. Enforce one line per `(version_id, fund_id)`; cycle start
  day 23; positive movement amounts and valid kind/endpoints; permitted effect
  kinds and sign/fund requirements; ordinal uniqueness; refund-purpose linkage;
  one live set per source; same-household member/account/category/source/event/
  parent/supersession/correction references.
- Same-household checks also cover optional payment/settlement accounts, linked
  refund allocations and decision provenance. Prevent supersession/correction cycles.
- Add indexes for household/cycle publication, household/fund/effective date,
  live source sets, member lookup, restricted account and command receipt keys.
  Include household scope in predicates; avoid broad indexes without a use case.
- Enable RLS and narrow SELECT grants. Deny client direct money writes; triggers
  preserve immutable history even for command mistakes. Explicitly revoke default
  function access. No stored fund balance, holds or purchase journal.

**Acceptance:** invalid cross-household references fail through privileged test
inserts as well as authenticated RPCs; duplicates and invalid signs fail; draft
and historical data permissions match the manifest; no anon exposure. Utility
source references remain disabled until packet H supplies proven household scope.

### C — plans, configuration and reconciliation commands (TERRA)

**Own:** three parent-reserved migrations (command foundation, plans and
reconciliation), with matching `budget_command_foundation.test.sql`,
`budget_plan_commands.test.sql` and `budget_reconciliation_commands.test.sql`.
The foundation provides fund creation/rename/retirement and account configuration
needed by the other commands; implementation signatures are frozen in the
[command API contract](command-api-contract.md).

**Objective:** implement the following member commands with receipts and stale-state
checks: `budget_save_draft_v1`, `budget_publish_v1`,
`budget_configure_account_v1`, `budget_record_reconciliation_v1`.

- Draft save takes optional draft ID, expected draft revision and a complete
  snapshot; clone from a published plan preserves stable line/fund IDs. Publication
  checks expected parent and publication sequence, freezes all labels/rules/income
  provenance and returns the exact version ID/number. Same-cycle edits replace
  whole-cycle targets. Published future plans remain independent; return divergence
  warnings. Forecast gaps are valid and never create resources.
- Reconciliation validates the JSON schema and every source key/value/household.
  Detect replacement of `(account_id,date)` snapshot values with a canonical
  fingerprint. Missing/stale/mismatched-currency sources cannot create complete
  status. Verify account inventory/settings changes against prior evidence.
- Freeze cutoff and opening evidence. A real opening is not generated from source
  history, expected salary, FinWise rollover or a spreadsheet surplus.
- Receipts cover draft, publish, configuration and reconciliation mutations. Validate
  same command/payload replay before applying expected-state checks to fresh work.

**Acceptance:** same-cycle original/current selection, mid-cycle first publication,
historical revision, future divergence, rename preservation, stale edit rejection,
payload mismatch and mutated observation invalidation. No funding RPC in this PR.

### D — fund assignments and corrections (TERRA)

**Own:** fund command migration and `budget_fund_commands.test.sql`.

**Objective:** implement `budget_move_funds_v1` and `budget_correct_movement_v1`
under the common receipt/lock contract. Reuse PR 1b's `budget_create_fund_v1` and
`budget_update_fund_v1` for creation, rename and retirement; introduce no duplicate
fund lifecycle API. Fund rename preserves historical labels.

- Opening/assign/release/reallocate use the positive amount and endpoints defined
  by the design. Require expected plan/reconciliation and a current resource
  fingerprint; funding occurrence keys include cycle, stable line and occurrence.
  Different command IDs cannot fund the same target occurrence twice.
- Opening requires explicit cutoff and verified opening resources. After cutoff,
  pre-cutoff purchases remain reporting facts with zero new opening debit.
- Corrections append the opposite movement and replacement in one transaction,
  with both rows linked to the original and the same command receipt. Restrict
  incompatible/repeated corrections. Retiring a fund never deletes history/money.
- Reject assignment from incomplete or insufficient resources. A known observed
  purchase can leave a deficit; an assignment command cannot manufacture money.
- Use the authoritative calculation helper from packet F, not duplicate formulas.
  Before packet H is integrated, reject restricted assignment and any mutation
  affecting earmarked money. Combined publish-and-move uses one transaction through
  existing internal helpers, not two client requests.

**Acceptance:** Gifts 100000 opening +50000 assigned -120000 purchase =30000 cents;
income alone does not fund anything; pre-cutoff debit is excluded; two concurrent
50000 requests against the last 50000 commit at most one; retries and occurrence
replays duplicate nothing; atomic correction/reallocation conserves the total.

### E — reviewed bank transaction allocations (LUNA, TERRA for integration)

**Own:** allocation migration and `budget_allocations.test.sql`. TERRA owns the
atomic integration with existing category/treatment/event command helpers.

**Objective:** implement `budget_review_allocation_v1` with a complete replacement
set, expected current set ID and expected source fingerprint.

- Freeze normalized source snapshot, original convention, occurred date, amount,
  account and decision provenance. Use paying bank/card recognition legs; mirror,
  internal transfer and card settlement legs have zero fund effect. Do not infer
  this from account balance sign or category labels.
- Validate source total equals component sum, fund/sign rules, member attribution,
  reviewed category agreement or explicit mixed split, refund-purpose linkage and
  receipt evidence for opposite-sign splits. Reject unsupported currencies and
  sub-cent conversion without a parent-approved rounding/evidence policy.
- Persist classification/treatment updates atomically where requested; never edit
  the existing confirmed decision in place or make a classifier proposal confirmed.
- Supersede one live set and insert its replacement atomically. Needs-review sets
  retain their last reviewed delta. Pre-cutoff actuals report without debiting
  opening again. Category/fund corrections do not change budget snapshots.

**Acceptance:** Cara's 60000 shared groceries keeps Cara as payer; later Gustav
transfer leaves groceries unchanged; 90000 split =60000 groceries +30000 gifts;
20000 refund restores Gifts; null-fund consumption fails; archived/changed sources
retain reviewed effects pending replacement; card repayment does not spend twice.

### F — authoritative calculations and initial read slice (LUNA)

**Own:** calculation/read migration and `budget_calculations.test.sql`.

**Objective:** supply one SQL calculation core for commands and read RPCs, then
`budget_get_overview_v1` and `budget_get_fund_v1` for the first slice.

- Aggregate movements and live reviewed allocation deltas separately before joining
  to avoid fan-out. Include retired funds and signed deficits. Apply cutoff once.
- Select original/current plan by cycle/publication rules, never sum revisions.
  Evaluate the cycle at Johannesburg local date; reporting may group by calendar
  month without changing allocation identity or fund balances.
- Return original/current plan, assignment/spend/refund/net balance, beneficiary,
  planned/actual payer, resource provenance, reconciliation state and reason codes.
  Keep contribution/debt commitments separate from consumption.
- Return net liquid resources, net/positive purpose claims, deficit amount and
  unassigned separately. Deduct card debt once; exclude credit limits, equity,
  future income and restricted balances from liquid resources. Until G/H complete,
  unsupported exposure/restrictions must explicitly limit completeness.
- Target-by-date calculation uses eligible balance and remaining funding dates,
  integer rounding and a due-now shortfall for zero dates. No automatic assignment.

**Acceptance:** 2000000 cash -300000 debt -1500000 claims =200000 unassigned;
funded 60000 card purchase and later repayment preserve that unassigned value;
50000 resources with funds +60000/-10000 reports a 10000 funding deficit;
600000 target -100000 saved across five dates suggests 100000, never writes money.

### G — source drift and pending exposure (TERRA)

**Own:** source-state migration, `budget_source_state.test.sql`, concurrent source
test runner cases. Leave Workers closed unless parent identifies a required seam.

**Objective:** calculate conservative availability from current evidence, preserving
confirmed allocation effects while source rows and balances change.

- Compare live source/decision fingerprints with frozen sets. Derive review reasons
  immediately in reads; controlled synchronization may mark needs_review, but
  correctness must not depend on an eventually scheduled job.
- Provider identity/explicit event evidence may connect pending to posted records.
  Same-merchant/amount/date alone is not proof. An unproved link is uncertainty;
  do not silently delete one source or assert two independent purchases.
- For known-purpose pending outflow, reduce unreflected resources and that purpose
  claim once. For unknown-purpose outflow, reduce unassigned resources only. Bank
  available-balance/pending inclusion evidence prevents a second resource debit.
- Reconcile observations and subsequent activity without adding rows already in
  an observed balance. Stale debt, unseen accounts, observation replacement,
  unavailable coverage and restricted-pending location decisions produce reasons
  and incomplete state. Source increases in outflow reserve only the additional
  unrecognized difference, retaining the prior reviewed effect.
- Race between source change and funding must not permit a confident overassignment:
  freeze/check affected sources under the common command locking/fingerprint rule;
  prove the behaviour with two database connections.

**Acceptance:** known 60000 pending leaves provisional unassigned 200000; unknown
60000 leaves 140000; posting replaces exposure once; available-balance inclusion
never double counts; changed/archived source history stays visible; ambiguous
identity and missing/stale accounts block new assignments.

### H — restricted claims and utility ownership (TERRA)

**Own:** restricted/utility migrations, `budget_earmarks.test.sql`,
`budget_utilities.test.sql`. Primary must first freeze the source ownership manifest.

**Objective:** implement the exact linked earmark commands and safe utility source
adapter without changing the HTTP ingest/consumer split or creating a new Worker.

- Add nullable household ownership to existing consumption devices and ledger
  entries with same-household parent/device constraints. Derive ledger ownership
  from an owned device during ingest; unowned/new devices remain unrecognized for
  budgeting. Backfill only device IDs with explicit verified ownership evidence,
  not every row merely because one household exists. Do not allow members to claim
  an unowned external device through an unchecked budget RPC. Parent supplies the
  provisioning path and targeted backfill manifest before dispatch.
- Existing ingestion must remain compatible. Tighten ledger/device read policies
  to household scope and test the service ingest path. Resolve any required source
  RPC adjustment additively in its migration; inspect consumer code only if needed.
- Extend existing event legs narrowly to support a utility entry XOR transaction
  with household scope and active-source uniqueness. Do not copy utility charges
  into fabricated public transactions. Preserve utility incurred/correction dates.
- Implement `budget_change_earmark_v1` using movement/allocation/event/reconciliation
  references. Positive/negative entries form an append-only claim ledger. Per-fund
  claim <= max(balance,0); per-account claim <= verified eligible restricted resource.
- Assignment/reallocation and matching earmarks commit together. Purchase/refund
  and movement corrections repair their exact linked claims once. Withdrawal
  releases require confirmed movement evidence; reconciliation-only location
  corrections cannot invent assigned funds.
- ISMRT top-up is resource movement, canonical usage/fees are expense recognition.
  Pair evidence through existing events; unmatched links/ownership remain unresolved.
  Do not combine wallet balances, bank top-ups and charges as extra resources or
  duplicate consumption. Aggregate canonical incurred charges, not reading estimates.

**Acceptance:** 1650000 mortgage transfer recognizes 650000 extra-debt outflow and
1000000 earmarks inside existing funds; 349400 car service consumes once, including
purchase-before-redraw; notice release becomes liquid without income; utility
top-up then usage spends once; correction/reallocation atomically repairs claims;
cross-household utility entry or event leg is rejected. Unverified redraw/wallet
resources remain excluded.

### I — complete query surface and integration acceptance (LUNA)

**Own:** final read migration, `budget_queries.test.sql`, API contract/runbook docs
and integration tests in `tools/budget-db-tests/`. No dashboard application files.

**Objective:** finish these member read RPCs on the same calculation core:

| RPC | Inputs | Required result |
| --- | --- | --- |
| `budget_get_overview_v1` | cycle start, as-of | Original/current plan, purpose balances, deficits, liquid/restricted split, unassigned, forecast gap, completeness/reasons/provenance |
| `budget_get_fund_v1` | fund ID, date range, cursor, bounded limit | Opening/assignments/releases/reallocations/purchases/refunds, resulting balance, correction/source links, target need, restricted claims |
| `budget_list_versions_v1` | cursor, bounded limit | Draft/published versions, effective cycles, parent/history and future divergence |
| `budget_get_version_v1` | version ID | Full frozen snapshot and line/income/source provenance |
| `budget_get_actuals_v1` | cycle or calendar month, beneficiary/payer filter, cursor, bounded limit | Components only, consumption versus commitments, both attribution axes, source/decision/correction trail |
| `budget_get_review_queue_v1` | cursor, bounded limit | Unallocated outflows, drift, missing ownership/coverage, ambiguous sources/utility links, impact and reasons |
| `budget_get_liquidity_v1` | as-of and forecast horizon | Observed/reconciled balances by payer account, card debt, restrictions, expected net income/payments and dates, indicative gaps/uncertainty |

- Use stable ordering and opaque keyset cursors tied to filters. A filter must not
  alter the separately returned household total. Cap list sizes and horizon.
- Fund detail preserves source identity and corrected lineage; actuals use the
  latest reviewed facts. Do not promise frozen/restated historical reports.
- Define exact JSON keys, nullable/unknown states, decimal-string cents, timezone,
  provenance, pagination and stable error codes in the API contract. Examples use
  synthetic IDs/amounts. Test member Data API calls using local tokens, not admin
  SQL alone. Explain plan targets versus funded money in field semantics.
- Run EXPLAIN on representative synthetic household/source volumes. Add only
  indexes supported by query plans. Read functions must not mutate money/history.

**Acceptance:** every row in data-and-delivery's acceptance table has a named test;
cycle edges 22nd/23rd and Johannesburg/UTC transitions pass; household filters
never duplicate totals; pagination is deterministic; outsider/anon/service-role
member reads fail; API examples match actual responses.

## Common builder brief (include verbatim in every dispatch)

You own only the files listed in this task's frozen manifest. You are not alone in
the codebase: preserve others' edits, do not revert them and accommodate integrated
dependencies. Implement the parent's contract exactly. Read AGENTS.md, CONTEXT.md,
the named spec sections and the named dependency files only. Leave data/, reports/,
dashboard components/generated types, classifier and ingest webhook closed.

Do not redesign financial rules, add business entities, guess provider signs,
invent opening values or broaden scope. Return a precise blocking question to
the primary if a required contract is absent or contradictory. You may choose
routine syntax/implementation details within the frozen contract. No production
writes, deployments, merges, pushes, destructive Git changes or unrelated cleanup.
Use disposable local DBs and synthetic fixtures. Run the named tests; failures
must be fixed or reported with exact evidence, never hidden by weakening assertions.

Return: changed files, implemented contract items, exact commands/results, failures,
remaining blockers and migration compatibility notes. No secrets/private source
payloads in logs, fixtures or docs. Primary owns migration filenames/order, shared
config/lockfiles, integration and PR submission. The primary creates migration
files through the pinned CLI and gives each builder one reserved filename.

## Dispatch schedule

1. Primary freezes live legacy DDL/bootstrap and release contract. LUNA A builds
   packet A; primary integrates/reviews and prepares PR 0 with the accepted design.
2. Primary freezes full schema/command manifest. TERRA builds B; LUNA builds
   independent pgTAP assertions from that manifest. Integrate and review schema
   PR 1a, then pause. After the user requests continuation, TERRA builds C in PR 1b.
3. Primary freezes allocation/calculation/command helper interfaces. LUNA A builds
   E, LUNA B builds F; TERRA builds D against the frozen F signature. Primary
   coordinates any shared helper edits. Integrate all three and test PR 2.
4. TERRA builds G; LUNA builders add independent source/pending/concurrency tests
   in separately owned files from the parent's acceptance manifest. Review PR 3.
5. Primary freezes verified utility ownership and restricted examples. TERRA builds
   H; LUNA builders implement independently specified assertion/API fixtures.
   Review PR 4.
6. LUNA A builds I; LUNA B implements the final acceptance matrix/integration tests.
   Primary integrates, obtains independent correctness/security review and prepares
   PR 5. Reviewer findings return to primary before any builder scope change.

Pause after each prepared PR; start the next stage only when the user requests it.
No overlapping migration ownership. Synthetic test setup helpers are
shared only after the owner integrates them. Parallel builders do not create user
sidebar chats. A reviewer is scheduled after builders complete to stay within
the available concurrency slots and avoid review of a moving implementation.

## PR and cutover gates

For each PR: preserve user changes; include only the logical stage; test clean
replay and baseline upgrade; run pgTAP, relevant member integration/concurrency
checks and SQL lint; inspect changed grants/RLS/function privileges; obtain
independent review of monetary/security changes; resolve findings; check whitespace;
attach the PR to this chat. Use short feature branches and the personal repo's
commit convention, with no invented Jira ID. Do not force-push or rewrite published
history. The design's earlier direct-to-master override does not apply here.

CI after an approved merge is the production migration/deploy mechanism. Primary
checks that the exact SHA passed gates, inspects migration/deployment results and
uses read-only post-release metadata/member smoke checks. Failure stops dependent
work. Repairs use a new forward migration/revert PR; no manual production repair
or history rewrite. Test fixtures never run against production.

Installing the backend is distinct from establishing a real funded budget. The
cutover runbook must retain all [open facts](evidence.md#facts-to-resolve-at-cutover):
net-pay bridge, line amounts/payers, account ownership/currency/coverage/freshness,
card debt, opening liquid/notice/mortgage reserves/redraw evidence, utility coverage,
annual due dates/targets and any actual contribution agreement.

Once the facts are resolved, import only a draft with exact source references and
validate its forecast. Prepare reconciliation and opening assignments at an
explicit cutoff for review. Apply them using the deployed audited member commands
after explicit financial activation authorization; do not hide household data
imports inside structural schema migrations. No Google Sheet or FinWise mutation
is required. Until that gate passes, status remains needs_reconciliation, with
no seeded amount presented as the household's real spending availability.

Backend completion means the accepted behaviour and query contracts pass local
database tests, existing CI checks and their PR releases succeed. Report financial cutover separately. Frontend
implementation, payroll ledger, FX engine, statement-driven card forecast, spouse
debts, general matching DSL, purchase journals and formal financial close remain
outside this build.
