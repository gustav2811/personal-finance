# Stage 3 source-state execution contract

Primary-frozen 2026-10-01. Authority: behaviour and data-and-delivery specifications.
Source-baseline proof clarified 2026-10-05 during integration acceptance.
Stack on funding PR #41. Additive migrations only; no Workers, dashboard, generated
types, deployment workflow changes, production writes or financial activation.

## Scope and invariants

No holds ledger and no automatic rewrites of allocations, receipts or history.
All current/needs_review reviewed effects remain authoritative until an explicit
allocation correction. Reads derive drift immediately. Archived or missing source
records must not silently erase a reviewed debit. Unknown facts are never zero.
Restricted/mortgage and utility-dependent resources remain excluded/unverified.

All helper functions: private finance schema, explicit qualified relations,
search_path=pg_temp, timezone=UTC, EXECUTE revoked from PUBLIC/anon/authenticated/
service_role. Read helpers STABLE SECURITY DEFINER. Existing public RPC signatures
and grants stay unchanged. Financial JSON amounts are checked bigint decimal strings.

## Engine and reconciliation

Implement finance.budget_source_exposure(p_household uuid, p_coverage jsonb,
p_asof timestamptz) returns jsonb. p_coverage is the validated/frozen coverage
snapshot (accounts include settings/snapshot/pending facts). It returns:

- complete boolean; reasons array of objects with code and bounded source/account/
  set/event identifiers; adjustments array in stable account/source order.
- resource_delta_cents signed string, fund_deltas object keyed by fund UUID with
  signed strings; provisional_known boolean (false when any necessary amount,
  identity, observation/sign/coverage or location cannot be determined).
- Each adjustment: transaction_id, account_id, set_id nullable, source_ids array,
  kind (pending, posted_after_observation, source_drift), amount_cents (positive
  exposure), resource_delta_cents (zero or negative), fund_deltas object,
  reflected_in_balance boolean, identity_basis (same_provider_id,
  confirmed_purchase_event, standalone), reasons array. No raw payload bodies.

Keep finance.budget_check_coverage's existing validation and all inventory,
settings, sign/currency, stale/replaced observation, activity_through and restricted
guards. It may use an exact renamed private copy of the old implementation as a
base. Replace only the blanket source_activity_unreconciled guard with the engine's
actual reasons. Reconciliation RPCs continue freezing canonical v1 coverage.
Revalidation keeps the exact old reconciliation fingerprint and immutable receipt
results. Historic incomplete status never becomes complete without a new record.
New reconciliations freeze server-only source_state_snapshot on each account:
{schema_version:1,sources:[{transaction_id,account_id,source_system,
source_transaction_id,amount_cents,effective_at,pending,archived,source_fingerprint}]}.
Sources are normalized owned rows present at that reconciliation, in source-ID
order; no raw payloads. Client coverage validation remains unchanged. Revalidation
strips this server field before client validation and evaluates exposure against
the ORIGINAL frozen field, not a newly reconstructed source baseline. A formerly
unlisted pending that becomes posted is still unreflected until a fresh observed
balance/reconciliation proves otherwise, even if its provider effective date was
before activity_through. A new posted row absent from a frozen baseline and dated
before activity_through has unknown inclusion (source_balance_inclusion_unknown,
NULL provisional totals); it cannot conjure spendable money. Legacy snapshots
without this field remain backward compatible but cannot prove such lifecycle
changes; a fresh reconciliation resolves uncertainty. No live baseline is written
by a read and no earlier reconciliation is changed.
Pending included IDs remain ownership checked. An included pending changing to
posted under the SAME provider row identity is expected lifecycle evidence only
when account, amount and other necessary facts remain proved; unrelated changed,
archived/missing pending evidence stays incomplete. No blanket removal of drift.

An unreviewed posted outflow incurred on or after the opening cutover remains
purpose_exposure_unresolved (even when a plan match exists, including rows already
reflected in the balance); pending gives pending_activity_provisional and blocks
funding. These states may have useful explicitly provisional totals. Posted fully
reviewed activity after the frozen activity_through may adjust resources and become
complete when all other evidence is sound. Positive post-observation activity never
creates extra spendable resources: income_after_observation_unreconciled until a
fresh observed balance is reconciled. No future salary/refund/unused credit.

## Identity, timing and money

Provider continuity is the same household/account/source provider row ID (the
upsert preserves public.transactions.id). Do not infer replacement identity from
parent_transaction_id or arbitrary raw JSON. A different ID may be collapsed only
through an owned confirmed PURCHASE event: exactly one active posted economic
recognition leg and pending mirror/staging legs on that same account with matching
normalized signed amount. Conflicting/extra recognition legs or invalid event/
treatment evidence are unresolved. Other event types are not purchase identity.
Keep every source ID in provenance. An explicitly linked included pending followed
by its posted representative is reflected once, not a fresh debit.

For an unlinked pending row and a posted row on the same account with equal
normalized negative amount and occurred_on within 7 days, flag
pending_identity_ambiguous; matching alone never deduplicates. Ambiguity makes
provisional_known=false and totals null; do not assert two independent purchases.
Same IDs and confirmed purchase events do not get this ambiguity reason.

Use effective_at, posted_at, occurred_on at Africa/Johannesburg midnight, then date
as the explicit source time, in that order. Missing time is incomplete. Sources
after p_asof are excluded from monetary adjustments (not future resources).
The coverage account's activity_through is the frozen observation/activity cutoff.
It cannot extend a balance observation: use the earlier of activity_through and
the referenced snapshot observed_at for reflection. A reconciliation using the
same older balance observation cannot clear a formerly unreflected pending
purchase merely because its source now says posted. Freeze/use the source
baseline to retain that exposure; only a later verified balance observation
covering its posted state replaces the adjustment.
Posted rows through that cutoff already occur in the balance. Pending rows occur
in the observed balance only when explicitly listed in pending_included_ids.
An included-ID pending-to-posted transition remains reflected under proved identity.
No cross-account inferred movements or extra card-debt debit: both liquid and card
outflows contribute one normalized negative net-resource delta when unreflected.

Pending purpose: use an owned confirmed classification+treatment compatible with
consumption/required_debt_payment/extra_debt_payment/contribution and exactly one
applicable published plan line with match_category_id matching the category and a
compatible kind. Select plan at that source's budget cycle/asof. No category-only
guess, fuzzy match, draft line or plan remapping of reviewed allocations. If no
unique eligible line, fund_deltas is empty: exposure consumes unassigned only.
Both treatment is_transfer and exclude_from_spend must explicitly be false; a
non-economic event type/leg cannot match a purpose. Nature consumption matches
line kind consumption, contribution matches contribution, and required/extra debt
payments match debt_commitment. Pending mirror/staging legs are identity evidence,
not independently matched purpose expenses.
Retired/missing/earmarked fund or restricted source requires uncertainty; no guessed
funding-location release. Known liquid purpose reduces claim by the exposure once.

For a current/needs_review allocation set, retain frozen component deltas. Compare
live full source fingerprint and derive source_allocation_stale without mutation.
Reserve only additional unrecognized outflow: max(live outflow - frozen outflow,0).
A sole purpose fund with all negative economic components may receive that extra
claim deduction; split/zero-effect ambiguity does not invent a proportional split.
An amount decrease/archive never releases reviewed claims or credits resources.
Resource adjustment for an unreflected source is its full conservative outflow;
for a source reflected at cutoff it is only the increased unrecognized amount.
Metadata drift contributes reasons, not another original debit. Reviewed pre-cutover
activity never debits opening claims again. Missing reviewed sources remain visible
and block confidence; use frozen provable exposure for provisional derivation.
An unreflected decreased/archived reviewed source retains at least its frozen
outflow resource debit. Every per-fund aggregate is a checked decimal string.

The opening cutover does not hide pending exposure: pending rows are evaluated
even when their incurred date precedes it. Proven frozen posted activity before
cutover needs no new purpose review or opening-claim deduction. A late posted
pre-cutover row absent from the frozen baseline has unknown balance inclusion and
requires fresh reconciliation or an explicit opening correction; it is not
silently omitted. The purpose-review gate for ordinary historical posted rows
starts at the opening cutover, as in the stage 2 contract.

## Resources and member reads

Replace finance.budget_resources(uuid,timestamptz) with the same existing keys plus
provisional_net_liquid_cents and provisional_fund_deltas. Add engine adjustments to
pending_adjustments and return all completeness reasons. Compute observed cash
minus debt plus resource_delta; net_liquid_cents stays NULL unless complete.
provisional_net_liquid_cents is NULL whenever observation/coverage/sign/identity
uncertainty prevents exact conservative arithmetic. Keep reconciliation fingerprint
interoperable with its public command output. No missing observation becomes zero.

Overview keeps existing historical balance_cents/net_claims_cents unchanged and adds
fund provisional_available_cents; top-level provisional_net_liquid_cents,
provisional_net_claims_cents, provisional_unassigned_cents, pending_adjustments.
Provisional claims = authoritative signed claims plus derived fund deltas. The
known60000 fixture: 1700000 resources ->1640000,1500000 claims ->1440000,
unassigned200000. Unknown60000:1640000resources,1500000claims,140000unassigned.
Included pending starts with already reduced observed balance: resource_delta0,
claim_delta-60000. Posted reviewed replacement removes pending claim deduction:
allocation becomes the single authoritative debit. Fund detail adds
provisional_available_cents and relevant source_adjustments using the same bounded
asof as its existing balance. No change to pagination/history ordering.

## Source/funding race boundary

All writes to public.accounts/snapshots/transactions and finance.budget_account_settings,
transaction_classifications/transaction_treatments, financial_events/financial_event_legs,
transaction_source_observations acquire the affected finance.households row mutex
in sorted old/new household ID order before becoming visible. Add private trigger
helper(s), SECURITY DEFINER, revoke all EXECUTE. Existing service source RPC behavior
and grants remain compatible. This covers new rows (phantoms) as well as updates.
Deadlock detection may abort a conflicting writer; never retry by bypassing locks.
Funding retains its household-first lock and reevaluates sources AFTER acquiring it.

Prove real two-connection overlap (PgSleep first, Lock second), not sequential calls:
source-first inserted pending -> funding budget_incomplete, no receipt/movement;
source-first snapshot reduction/replacement -> funding budget_incomplete;
funding-first -> source write blocks, funding sees its serialized prior evidence,
then later reads see drift. Include mutation of existing amount and new account
inventory or new transaction phantom. Original five races remain unchanged.

## Acceptance ownership

Core builder owns source-state migration and bounded source-state tests. Read builder
owns additive resources/read migration and member acceptance tests. Race builder
owns source-concurrency.sh and its runner/README hookup. Primary owns contracts,
integration and decisions. Builders report ambiguities to primary rather than invent
semantics. All work local, synthetic disposable PostgreSQL only. Final full migration
replay/all earlier tests, real race tests and independent correctness/security review
must pass before creating this PR. Pause before stage 4.
