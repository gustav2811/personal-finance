# Data and delivery

Status: simplified design, revised 2026-09-29 after the household accepted the
complexity review. This replaces the earlier 24-table proposal. It is not a
migration or an implemented schema.

## Ownership of facts

| Fact | Authoritative record | Derived, not separately written |
| --- | --- | --- |
| What we agreed | Immutable budget version and its lines | Original versus current plan comparison |
| What was spent and for whom | Current reviewed transaction allocations | Spend totals and payer attribution |
| What we assigned to a purpose | Fund movements | Contributions and reallocations |
| What remains in a fund | Movements minus allocation effects | Fund balance; no purchase journal |
| What money exists | Existing account balance observations plus reconciliation | Net household resources |
| What is restricted | Explicit fund earmarks against a restricted account | Immediately accessible portion of a fund |

A normal purchase creates one allocation set with one allocation. It does not
also write a fund journal, card obligation, resource hold or backing entry.
Current balances are queries over facts, not independently maintained totals.

Reuse `public.accounts`, `public.transactions`, `public.snapshots`, owned
categories, classification/treatment history, and financial events/legs. Preserve
the Worker boundaries and shadow classifier. The dashboard remains a member client.

## Nine small tables, five responsibilities

Nine is a concrete starting proposal, not a table-count target. Header/detail
pairs are retained where atomic splits and immutable snapshots justify them.
Every new record carries `household_id`; same-household references are enforced.
Use integer ZAR cents for new budgeting amounts, UUIDs for new IDs, local dates
for cycles, and timestamps for audit events. Existing transaction IDs are text;
existing `accounts.account_id` is UUID. Foreign-currency activity is unresolved
until an evidenced ZAR conversion is available; a general FX engine is deferred.

### 1. Budget versions and lines

**`budget_versions`**: id, household_id, version_number, parent_version_id,
state (draft/published), starts_on_cycle, published_at, actor, reason,
calculation_version, income_assumptions, source_references.

One household budget is identified by `household_id`; no separate `budgets`
table. The operating cycle is fixed to the confirmed 23rd–22nd convention in v1.
A version contains a full snapshot, not a patch. The latest published version
starting on or before a cycle is that cycle's plan; publication sequence resolves
multiple versions for the same cycle. Future versions start on future cycles.
Changing an already-started cycle changes its whole-cycle targets explicitly.
No separate period or amendment tables and no automatic prorating.

The original plan is the version applicable as of the start of that cycle; if
budgeting begins mid-cycle, it is the first published version covering the cycle.
Publication timestamps preserve that selection even when later versions replace
the same cycle's targets. A future version is a full snapshot: editing an earlier
cycle does not silently change an already-published future version; flag the
divergence for review. Changes to historical cycles remain explicit new versions.

`income_assumptions` is a small validated snapshot array of person, expected net
cash, expected date and provenance. Optional payroll context is display-only.
This avoids a payroll accounting subsystem. Names/group labels used by the plan
are frozen with the version. Income forecasts never create available resources.

**`budget_lines`**: version_id, stable_line_id, fund_id, name/category/group
snapshots, beneficiary (shared/member), planned payer, kind, contribution_cents,
funding_behaviour, optional target_cents, due_on, recurrence, rollover policy,
optional expected payment date/account, simple category match criteria.

Target behaviour, dates and ordinary bill expectations live on the line. One
current target per line is enough for v1. Multiple dated obligations inside one
fund and a general matching-rule language are deferred. A mapping may suggest a
fund only when category and beneficiary resolve unambiguously; otherwise review.
All money-use lines reference a stable fund, including allowances temporarily
reserved for contributions or debt payments. The plan's line kind distinguishes
consumption, contribution and debt commitment; do not sum them all as expenses.

Enforce unique `(version_id, fund_id)`: one line and target per fund in a version.
Separate fuel/bill lines use separate funds; reporting may group them by category.
This prevents two targets from both crediting the same saved balance. A retired
fund may have no current line; it retains actuals and balance without a new target.

### 2. Persistent funds

**`funds`**: id, household_id, name, beneficiary, active/retired, created_at.

A fund is a stable purpose such as Groceries, Gifts or Cara personal care. Its
balance is not stored on this row. Targets belong to versioned lines. Renaming a
fund does not rename an old budget snapshot; changing category meaning requires
explicit mappings and never rewrites past allocations. Retiring a fund preserves
its balance and history until money is released or moved.

### 3. Reviewed transaction allocations

**`budget_allocation_sets`**: id, one source reference (transaction or utility
entry), immutable normalized source snapshot/observation reference, version,
supersedes_id, status (current/superseded/needs_review), actor, recorded_at,
command_id, category/treatment decision references.

**`budget_allocations`**: set_id, ordinal, signed source amount, fund_id nullable,
category_id, beneficiary, paid_by_member, payment_account_id, effect_kind,
optional linked original refund allocation, optional existing financial_event_id.

Exactly one current set per source; all component signed amounts sum to its
normalized source amount. Components replace the parent in totals. Effects are
explicit: consumption, contribution, required debt payment, extra debt payment,
refund, income, financing, movement or unresolved. Income and financing affect
resources through source balances, not an extra fund credit. A transfer can be attributed without consuming
a fund. Never infer treatment from category name alone.

Normalize source monetary direction before review: money leaving the observed
account is negative; money entering it is positive, regardless of provider debit/
credit conventions. Preserve the original sign convention and normalized amount
in the source snapshot. Split components sum to that normalized source amount.
Use the paying cash/card leg for purchase or debt-payment recognition; the receiving
loan/transfer leg remains a mirror with zero fund effect. Do not turn a liability
balance's sign into a transaction-flow sign.

For consumption, contribution, required debt payment and extra debt payment,
`fund_id` is required and amount is negative. For refund it is required and amount
is positive, linked to the original purpose allocation (or an explicitly reviewed
opening-period purpose). These signed amounts are their fund deltas. Income,
financing, movement and unresolved components have zero fund delta regardless of
source amount; they may have a null fund. A confirmed fund-affecting expense can
never hide as a null-fund actual. Missing attribution stays unresolved and affects
provisional availability. Mixed opposite-sign splits require receipt evidence,
not merely a mathematically valid net sum.

Sets retain source amount/date and decision provenance, so review does not depend
on a later mutation of the source row. An atomic supersession changes the current
actuals once; no reversing purchase journal is needed. Source changes mark the
set for review and expose the difference. Retain its previous confirmed effect
until replaced, flag totals provisional and conservatively reserve additional
outflow once. Do not silently erase a purchase when its source is archived.

Allocation records refer to stable funds, not whichever budget revision is
current today. Plan edits cannot remap earlier spending. Corrections to category,
beneficiary or fund are explicit audited replacements. This removes a second
historical mapping timeline. Classification remains in the existing classification
tables; allocation category must agree with the reviewed decision, or with the
explicit reviewed split for a mixed purchase.

### 4. Fund movements

**`fund_movements`**: id, household_id, from_fund_id nullable, to_fund_id nullable,
positive amount_cents, kind (opening/assign/release/reallocate), effective_on,
recorded_at, actor, command_id, optional budget_version_id, correction_of, reason.

Null denotes unassigned household money. Assignment moves null → fund, release
fund → null, reallocation fund A → fund B. Both endpoints null or equal are
invalid. One row records both sides of a reallocation, so it cannot be half-applied.
Opening assignments require the cutover reconciliation. Corrections append an
opposite movement plus replacement if needed; never mutate monetary history.

This is a purpose-allocation ledger, not double-entry bookkeeping for purchases.
Source purchases and refunds affect fund balances exclusively through allocations.
An income receipt increases resources; it is not also a movement into a fictional
income bucket. Assigning that money is a separate, explicit action.

### 5. Account configuration, reconciliation and restricted earmarks

**`budget_account_settings`**: account_id, household_id, member owner/shared,
included/excluded and reason, resource_class (liquid/restricted/mortgage/card/
tracking-only), optional settlement_account_id and usual due day, freshness rule,
updated_at, actor. Record settings changes through the application's audit path;
reconciliations retain the actual settings used. Do not create a generic temporal
routing engine. Existing `account_semantics.owner_scope` means household/external,
not Gustav/Cara, and remains that boundary.

**`budget_reconciliations`**: id, household_id, as_of, actor, status, coverage_snapshot,
opening_fund_cutover nullable, notes. The validated coverage snapshot records all
expected accounts/liabilities, included/excluded/missing status, ownership/settings,
source balance references and timestamps, balance convention (cleared/available),
pending amounts already included, verified restricted/redraw limits and reasons.

Use an immutable, versioned JSON schema for this small snapshot, not free-form
JSON for operational money events. Source balances remain in existing snapshots;
reconciliation documents how they were checked. A new/changed account or missing
required balance invalidates completeness until reconciled. Latest eligible
resources are calculated from those observations and reconciled subsequent
activity, never by adding transactions already included in a balance.

**`fund_earmarks`**: id, fund_id, restricted_account_id, signed amount_cents,
effective_on, recorded_at, actor, command_id, source_event/allocation or
reconciliation reference, fund_movement_id, correction_of, reason.

This narrow exception records only claims held in notice accounts, prepaid utility
wallets or the access mortgage. Ordinary cash is pooled: no grocery-to-bank-account
matrix, backing pools or separate backing journal. Earmarks are a *subset* of a
fund's balance, not extra money or a second spending ledger. Their sum for each
fund cannot exceed its nonnegative balance, and account totals cannot exceed
verified eligible restricted resources.

A purchase funded from a restricted reserve, or a withdrawal making it liquid,
releases the relevant earmark in the same command as the reviewed event/allocation.
If the source changes, the correction command repairs the linked earmark change
atomically. Reallocation of earmarked money moves both fund and earmark claims
atomically. Negative funds have zero earmarks and an explicit deficit. This one
exception supports the household's real mortgage arrangement without modelling
physical backing for every cash purchase.

Earmarks created by opening assignments, assignments or reallocations must link
to their exact `fund_movement_id`; paired fund/account deltas must match the
restricted portion of that movement. Correcting that movement reverses/replaces
its linked earmark deltas atomically. Purchase/refund corrections instead link
to allocation IDs; withdrawal releases link to the existing movement event.
These links prevent a correction from stranding a restricted claim or releasing
it twice. Reconciliation-only changes require an explicit explanation of the
resource/location correction and cannot create a fund assignment by themselves.

## Calculations and lifecycle

See [behaviour](behaviour.md) for equations and examples. The query combines fund
movements, current reviewed allocation effects and restricted earmarks. Pending
and unresolved exposure is derived from existing source states and allocations;
there is no separately writable holds table. Card debt is deducted once from
resources; a payment reserve is not a second budget balance.

Match pending-to-posted identities using provider identity/evidence. If the link
cannot be established, label availability uncertain rather than assert both are
separate expenses or guess away a real expense. Missing sources, stale balances
and unknown treatments remain visible in one reconciliation/review queue.

Do not promise reproducible closed financial statements in v1. Budget versions
are immutable; historical actuals use the latest reviewed facts with correction
history visible. Formal close/report revisions can be added when required.

## Commands and invariants

- Publish a complete budget snapshot with expected parent/version and command ID.
  Reject stale edits; show full-cycle changes. Changing the plan does not fund it.
- Assign/release/reallocate funds with expected reconciliation/version. Lock the
  affected household resources/funds, check completeness and amounts, and commit
  once. A target occurrence can be funded only once for its idempotency key.
- Review an allocation set atomically against the expected source/current set.
  Simple purchase: one header and one component; split purchase: several components.
- Record a reconciliation or restricted earmark with evidence. Opening positions
  require an explicit cutoff; old transactions cannot debit opening funds again.
- All commands use same-household foreign keys and membership checks. New tables
  get RLS and minimum grants. The browser never gets a service credential.
- Published plans, source snapshots, money movements and superseded allocations
  remain available. No cascading deletion of financial history.
- Same command/same payload returns its prior result; changed payload is rejected.
  Deterministic row locks or serializable transactions prevent concurrent funding
  from consuming the same unassigned money twice.
- Source mirror/settlement roles reuse financial events. Count each economic
  effect once, including card repayment and utility top-up pairs.

## Deliberately deferred

Separate targets/commitments/obligations tables; multiple dated goals within a
fund; general matching DSL; separate budget/period/amendment entities; purchase
journals; general account-to-fund backing allocations; stored resource holds;
card statement/settlement workflow; reimbursement links; formal report close and
restatement; full payroll bridge; multi-currency planning; arbitrary cycle changes.

None of these is required to attribute a shared purchase to its actual payer.
Deferral does not relax balance completeness, audit, concurrency or access rules.

## Delivery order

1. Reconcile the spreadsheet's net income and current amounts; verify accounts,
   card debt, coverage and opening reserves. Import a draft with source references.
2. Build versions/lines, stable funds and movements. Derive balances; demonstrate
   gifts, clothing and personal care accumulation without requiring AI decisions.
3. Connect reviewed allocations to existing transactions. Ship the shared-purchase
   journey and split editor, source-change handling and card repayment exclusion.
4. Add restricted earmarks and utility recognition with existing financial events.
   Validate mortgage and notice-account examples before including those reserves.
   Until then, display them as unverified and exclude them from liquid availability.
5. Show payer liquidity and an indicative due-date calendar from line/account
   settings. Detailed statement-driven forecasting remains optional later work.

No migrations or production writes are part of this design revision. Implementation
must use local fixtures, database constraint/RLS tests and a reconciled cutover.

## Acceptance examples

| Case | Expected result |
| --- | --- |
| Shared groceries R600 on Cara's card | One allocation; shared groceries falls 600; actual payer Cara |
| Gustav transfers 600 to Cara afterwards | Internal movement; no second groceries expense or automatic spouse debt |
| Gifts opens 1,000, assigned 500, purchase 1,200 | 300 remaining; monthly contribution is not the spending limit |
| Annual target 6,000, saved 1,000, five funding dates | Suggested contribution 1,000; target alone does not assign funds |
| Groceries plan 6,000 becomes 6,500 | New full snapshot; revised target 6,500; actuals unchanged |
| Plan rename or changed category mapping | Old plan label and earlier allocations remain unchanged |
| Mixed purchase 900 | Allocations 600 groceries + 300 gifts; parent not counted too |
| Cash 20,000, card debt 3,000, fund balances 15,000 | Unassigned 2,000; no separate reserve deduction |
| New funded card purchase 600, then repayment | Funds 14,400; cash/debt 20,000/3,600 then 19,400/3,000; unassigned stays 2,000 |
| Pending card row becomes posted | Derived exposure replaced once, no stored hold to reconcile separately |
| Mortgage transfer 16,500 | 6,500 extra-debt allocation; 10,000 restricted earmarks within existing assigned funds; no double contribution |
| Car service paid from mortgage reserve | One expense allocation; earmark released once; withdrawal is movement |
| ISMRT top-up then usage | Top-up moves resources into restricted wallet; usage consumes purpose once |
| Refund 200 to a previous gift purchase | Linked allocation restores Gifts by 200; not salary/income |
| Income arrives | Resources rise; purpose balances rise only on explicit assignment |
| Correction to a purchase | Supersede allocation set; balance recomputes; no reversing purchase journal |
| Required account missing or stale | Availability marked incomplete; no confidently spendable total |
| Concurrent requests assign last 500 | At most 500 assigned; retry creates no duplicate |
| Cross-household source/fund/member reference | Database denies read/write, including RPC paths |
| Consumption/refund confirmed without a fund | Rejected; unresolved attribution remains visible |
| Provider debit signs differ | Normalize before review; purchase delta negative, refund positive, movement delta zero |
| Two active target lines reference the same fund | Rejected by version/fund uniqueness; no reused target credit |
| Restricted assignment corrected | Its linked earmark change reverses/replaces in the same transaction |

These are implementation gates. Documentation verification checks links,
arithmetic, consistency and independent review, not execution of this schema.
