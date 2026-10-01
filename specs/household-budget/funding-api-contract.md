# Funding, allocation and initial reads execution contract

PR stage 2, stacked on #38. Primary-owned refinement of backend-contract.md and
behaviour.md. Three additive migrations: bank allocations/source normalization;
calculations/reads; fund movements/corrections. No earlier migration or workflow
edits, dashboard, utility ownership, earmarks, source-delta engine or live writes.

## Shared rules and ownership

Reuse PR1b scalar/object validators, canonical receipts and household-first lock.
Normalize EVERY allowed key statelessly before replay. Optional absent/null become
JSON null. Amounts are signed bigint decimal strings, not JSON numbers. Descriptive
strings trim; all nested unknown keys reject. UUIDs/date/timestamp rules stay PR1b.
Every helper explicitly revokes PUBLIC/anon/authenticated/service_role EXECUTE.
All functions set search_path=pg_temp and timezone=UTC, qualify objects, no dynamic
client SQL. Public commands are SECURITY DEFINER authenticated-only. Public reads
are STABLE SECURITY DEFINER with already-bound auth membership and trusted role;
they never call volatile bind/resolve, mutate history or acquire write locks.

Previous RPCs force constraints immediate. New commands MUST `SET CONSTRAINTS ALL
DEFERRED` after replay, before domain INSERTs. Insert receipt LAST, then force all
constraints IMMEDIATE before returning. Receipt FKs cannot be checked before the
receipt exists; allocation split can be validated explicitly before receipt. Tests
must call several RPCs in one transaction to prove this works.

Use NUMERIC intermediate sums/negation to avoid bigint overflow; validate final
bigint helper values before casting, budget_invalid on unrepresentable results.
No missing observation becomes zero. Existing movement/allocation history guards
remain intact. Shared helper names/signatures below are frozen.

Builder E owns ONLY 20261001064014_budget_bank_allocations.sql and
budget_allocations.test.sql. Builder F owns ONLY
20261001064021_budget_calculations_reads.sql and budget_calculations.test.sql.
Builder D owns ONLY 20261001064030_budget_fund_movements.sql and
budget_fund_commands.test.sql. Primary owns docs/runner/integration. No builder
edits another's file, shared helpers or prior migrations without primary approval.

## E: bank source and reviewed allocations

`finance.budget_source_snapshot(uuid household,text transaction) RETURNS jsonb
STABLE`. Missing/foreign source or source account -> budget_forbidden. Validate
same-household account, account currency and transaction currency both exactly ZAR,
finite numeric amount with amount*100 integral and normalized value within bigint,
explicit occurred_on, settings sign !=unknown and nonempty evidence. No fallback
to details/category/balance sign. outflow_negative retains amount*100;
outflow_positive negates it using numeric, validate AFTER normalization. Include
complete boolean/reasons array for incomplete evidence (no throw for unknown
amount/sign/currency). Normalized amount_cents is null when invalid.

Snapshot contains transaction_id/account_id/household_id, amount_cents string,
occurred_on, original_amount string, source_system, currency_code,
account_currency_code, sign_convention, settings_fingerprint, owner_scope,
owner_member_id, source timestamps/effective_at/posted_at/date/raw_payload_hash,
source_observation_id (latest same-household matching current raw_payload_hash,
nullable), pending/archived raw booleans, confirmed classification_id/treatment_id,
classification facts (id/category_id/status/decision_source), treatment facts
(id/is_transfer/exclude_from_spend/nature/event_id/leg_role/status), active event
facts (event id/type/status and leg id/role/status). Do not hash live category name.
Require explicit pending=false and archived=false for fresh allocation writes;
source helper still returns archived/pending facts to detect drift. Confirmed rows
only are authoritative, never latest proposal. Event/decision source/household must
match. Any nonnull treatment event_id/leg_role must match the active confirmed
source event/leg; mismatches mark the source incomplete. Hash entire normalized
snapshot EXCEPT source_fingerprint, then append
source_fingerprint. No raw private payload bodies stored; hashes/operational facts.

Public `budget_review_allocation_v1(uuid,jsonb) RETURNS jsonb` payload stays main
contract. This stage accepts bank sources only: nonnull utility_entry_id raises
budget_incomplete before PR4; simultaneous bank/utility sources raise budget_invalid.
Null utility_entry_id is equivalent to omission. New optional `decision_update`
is object with required category_id,
is_transfer,exclude_from_spend and optional nature (nullable max80chars). When
present top-level classification_id/treatment_id must be null. It calls existing
finance_set_transaction_category_v1 and finance_set_transaction_treatment_v1
inside this transaction, expected confirmed/proposed IDs read under source lock;
review command names are commandUUID||':budget:category' / ':budget:treatment'.
Check returned conflict boolean -> budget_stale; reject active event membership
before decision update (budget_incomplete; event review is a later seam). Rebuild
source snapshot AFTER decisions; store post-update fingerprint. Validation failure
rolls back both feedback/decision histories and the allocation receipt. Never call
finance_record_classification_run or directly overwrite confirmed decisions.

Before state changes: begin household lock, lock owned account then transaction
row, compare expected_source_fingerprint with current normalized snapshot;
require complete source and posted/nonarchived state. Compare expected_current_set_id
with actual current OR needs_review row (null for new). New revision=1, otherwise
previous+1 (safe integer bound) with supersedes_id. Mark old superseded only inside
same atomic replacement. Preserve all prior components; never delete or mutate.

Components: required amount_cents,beneficiary_scope,effect_kind; optional fund_id,
category_id,category_name_snapshot,beneficiary_member_id,paid_by_member_id,
payment_account_id,original_refund_allocation_id,opening_refund_reason,
financial_event_id. Server ordinal from array order. Nonempty array, all amounts
sum exactly source cents using numeric. Outflow effects negative+fund required;
refund positive+same-fund original outflow OR explicit opening_refund_reason.
No fund allowed for income/financing/movement/unresolved. Mixed signs need nonempty
evidence.receipt_reference. Evidence allowed keys exactly receipt_reference,
split_review_reason,review_reason (nullable text); normalize optional keys.
Zero-effect means zero fund delta, not a zero source/component amount: a transfer
of -90000 cents is a -90000 movement component with no fund.

All referenced funds/members/categories/events/refunds same-household. Earmarked
fund (any historical earmark rows) is budget_incomplete before PR4. Retired funds
allowed for corrections/refunds to existing history, not a new source's outflow
set. A correction may retain a retired fund only if that fund was in the preceding
live set; another source's allocation history does not authorize a fresh outflow.
payment_account_id defaults to actual source account; supplied different account
rejects budget_invalid. For member-owned accounts actual payer is owner_member_id;
supplied different payer rejects budget_invalid. Shared account keeps explicit
nullable payer. All persisted inferred facts freeze on fresh execution, never replay.

Purpose effects require current confirmed classification AND treatment. Supplied
IDs must match actual current decisions. Category omitted defaults confirmed
category; different component categories require evidence.split_review_reason.
Snapshot category name supplied trims, otherwise fresh owned category name; old
allocation labels never refresh. Non-economic event legs (mirror/staging/settlement/
reserve_funding/internal_conversion), confirmed internal_movement/settlement/
internal_conversion events, or transfer/excluded treatment permit only zero-fund
effects. No double purpose debit for repayments/mirrors. For zero effects confirmed
treatment is required except explicit unresolved; unresolved remains incompleteness.
Any supplied financial_event_id must match active confirmed same-source event.
No new financial event creation or utility allocation in this PR.

Return {set_id,revision_number,allocation_ids,source_fingerprint}. Validate split
explicitly, finish receipt, force deferred constraints. Replay returns exact result
even after source/decisions/set changes. Failed fresh work leaves no receipt.

## F: calculations and initial member reads

`budget_checked_bigint(numeric) RETURNS bigint IMMUTABLE`: finite integral within
bigint, budget_invalid otherwise. `budget_reader_household() RETURNS uuid STABLE`:
auth.uid nonnull/trusted JWT role authenticated; select already-bound member
auth_user_id (exactly one household), otherwise budget_forbidden. No auto-binding.
`budget_cycle_start(date) RETURNS date IMMUTABLE`: Johannesburg local date's 23rd
or prior month's 23rd, no timezone inference from session.
`budget_plan_versions(uuid household,date cycle,timestamptz asof) RETURNS jsonb
STABLE`: {original_version_id,current_version_id}. Current published_at<=asof,
starts_on_cycle<=cycle ORDER BY starts_on_cycle DESC,version_number DESC. Original
uses same ordering among published_at<=cycle's Johannesburg midnight; if none,
earliest publication applicable to cycle (published_at,version_number ASC). Never
sum revisions; drafts excluded. Null versions valid incomplete evidence.
`budget_opening_cutover(uuid household) RETURNS date STABLE`: first established
nonnull cutoff from complete historic reconciliation (recorded_at,id ASC), elseNULL.

`budget_fund_balances(uuid household,date asof) RETURNS TABLE(fund_id uuid,
balance_cents bigint,assigned_cents bigint,outflow_cents bigint,refund_cents bigint,
restricted_cents bigint) STABLE`. ALL household funds incl retired/zero/negative.
Movement contributions to endpoints aggregate separately from allocation deltas
to avoid fan-out. All effective_on<=asof; correction reversals/replacements ordinary
signed endpoint effects. current AND needs_review sets retain frozen components;
assigned_cents is the net movement endpoint contribution, including releases and
reallocations out, rather than gross incoming movements.
superseded zero effect. Allocation occurred_on before opening cutoff reports but
zero balance delta; no cutoff => allocation balance delta zero, reads flag missing
cutover. Purpose outflows negative sum returned positive outflow_cents, refunds
positive. Contribution/debt effects reduce fund but are separate actual categories.
Restricted sums currently zero (claims disabled); don't manufacture liquid money
from restricted account balances. All final totals checked before bigint casts.

`budget_resources(uuid household,timestamptz asof) RETURNS jsonb STABLE` keys
reconciliation_id,reconciliation_fingerprint,complete,reasons,net_liquid_cents,
restricted_resources,accounts,pending_adjustments. Pick newest reconciliation
as_of<=requested asof ORDER BY as_of DESC,recorded_at DESC,id DESC, INCLUDING
incomplete records (no fallback to older complete). Call PR1b reconciliation_state
at requested asof. Sum verified frozen included liquid normalized cash minus card
debt ONCE using numeric; excluded accounts don't contribute. If missing/invalid
required balances net_liquid_cents=NULL, never partial confident total. No
reconciliation -> completefalse reasons reconciliation_missing, null totals/ids.
Accounts are frozen coverage; restricted_resources=[] and pending_adjustments=[]
this stage, with checker reason gates retained. No future income/credit/equity.

Extra completeness guards: current/needs_review allocation source snapshot hash
differs from live budget_source_snapshot -> source_allocation_stale (retain delta).
needs_review/unresolved components -> reasons. Nonarchived included-account source
outflows occurred_on>=cutoff through requested local asof date without live reviewed
set -> purpose_exposure_unresolved, even if balance already reflects them. Missing
source facts -> source_unverified. Pending/post-observation activity remains PR1b
checker gate. No conservative source delta calculation until PR3; unknown current
availability stays null rather than pretending observed old balance is spendable.

`budget_target_suggestion(jsonb line,bigint balance,date asof) RETURNS jsonb STABLE`:
shortfall_cents,remaining_funding_dates,suggested_contribution_cents,due_now. Eligible
balance=max(balance,0). target_by_date monthly 23rd funding dates >=asof and<=due_on,
ceil(shortfall/count); count0 => entire shortfall due_now. reserve_target shortfall;
cycle_allowance/accumulating use contribution. Forecast only, no writes.

Public overview exact signature in backend-contract. Validate day23 cycle, finite
asof<=now. Response calculation_version='household-budget-v1',household_id,as_of,
complete,reasons,cycle_start,end_exclusive,original_version_id,current_version_id,
original_plan,current_plan (headers+full frozen lines),funds (fund facts+balance
fields+beneficiary+payer+target suggestion),net_liquid_cents,net_claims_cents,
positive_claims_cents,deficit_cents,unassigned_cents,provisional_unassigned_cents,
forecast_gap_cents,provenance. Claim totals from current signed balances through
requested local date. deficit=max(positiveclaims-netliquid, sum(abs negativefunds),0)
when resource total known; unassigned=netliquid-netclaims ONLYcomplete resources,
otherwise null. provisional_unassigned=NULL until PR3. Forecast gap=current line
contribution total - expected_net_income (signed string; null when no plan).
No plan/cutover => completefalse explicit reason. Resource complete and known
deficit may coexist: complete means known facts, NOT all purposes fully backed.

Public fund detail exact signature in main contract. Validate owned fund, date
range from<to, limit1..200, strict opaque base64 JSON keyset cursor tied to
household,fund,from,to and version1; reject malformed/mismatched filters.
Return calculation_version,household_id,as_of,complete,reasons,fund,balances,
restricted_cents,liquid_cents,target_suggestion,entries,next_cursor. Ending balances
at min(to-1,Johannesburg today); resources at min(now(),to's local midnight-1us).
Target suggestions use the plan applicable at that same bounded query as_of.
Stable entries ORDER effective_on DESC,recorded_at DESC,entry_type DESC,id DESC.
Movements and ALL allocation revisions in requested range, with signed amount and
effective_delta_cents=0 for superseded/precutoff allocations; annotate active effect,
source_transaction_id,set_id/supersedes_id/status/correction_of/correction_role,
category snapshot,beneficiary/actual payer/payment account. Do not sum page entries
as household balances. Strict typed cursor, no client SQL or offset pagination.

## D: fund assignments and corrections

Use main payloads/signatures. earmarks optional array must be [] (nonnull array),
otherwise budget_incomplete. Validate amount>0, kind/endpoints exactly schema,
effective_on between established cutoff and Johannesburg today. Lock household,
owned accounts/snapshots/source transactions in deterministic order, affected funds
ordered IDs. Use F helpers (no duplicate balance/resource formulas). Require latest
resources reconciliation ID/fingerprint expected match, current check complete.
expected_version_id must equal current published plan applying to effective cycle.
Opening requires effective_on=cutoff, no prior ordinary opening for target fund.
Targets active; retired source can release/reallocate existing money. All referenced
funds owned; any earmark history on involved funds -> budget_incomplete.

Opening/assign amount <= max(netresources-netclaims,0); no future salary. Release/
reallocate amount <=max(current source balance,0). Validate final positive claims
do not exceed max(netresources,previous positiveclaims): may improve an existing
deficit, never increase unbacked positive claims. No silent resets or automatic
funding.
All availability/source-balance/final-backing checks use Johannesburg today's
balances, including later effective history when a command is backdated. Insufficient
source balance or backed unassigned resources raises budget_insufficient.
Manual assign without occurrence key valid; when supplied only kind assign,
strict `cycle:YYYY-MM-DD:line:UUID:occurrence:POSITIVEINTEGER`; cycle must match
effective cycle and stable line must belong to expected version and target fund.
Canonicalize embedded UUID through uuid::text and ordinal through positive bigint
(1..9007199254740991), reconstruct the key before replay. Case/leading-zero variants
cannot create a second occurrence.
Duplicate key even different command -> budget_conflict. Corrections ignored by
ordinary unique key index; preserve occurrence key for audit.

Correction requires owned original ordinary movement, never correction-of-correction
or already reversed. Lock same resources and all original/replacement funds. Exact
opposite reversal uses schema kind mapping. Optional replacement parsed fully
stateless before replay, endpoints/date/amount validated. If correcting opening,
replacement kind opening and date same established cutoff; no second ordinary
opening at replacement target except original's own fund. Other replacement cannot
invent opening. budget_version_id optional: when omitted choose current applicable
published version; supplied must equal it. Corrections retain original effective
date for reversal. Insert reversal+replacement then validate FINAL combined balances
and backing, not transient reversal state; legitimate corrections may expose signed
fund deficits, never create unbacked positive claims. Net claims final cannot exceed
max(netresources,previous netclaims). No receipt on any rejected correction.
Return reversal_movement_id and nullable replacement_movement_id.

## Required local acceptance and completion

Use Docker `bash tools/budget-db-tests/run.sh` (psql inside container, no CLI login).
Tests are real authenticated member RPCs; privileged setup/fingerprints BEFORE role
switch. Reset error flags and assert exact P0001 prefixes; final deferred constraints.
E: Cara shared60000 retains Cara payer, 90000 split60000/30000, refund20000 linked
Gifts, opposite signs with/without receipt, zero-effect transfers/mirrors/repayment,
wronghousehold/source/sign/currency/subcent, supersession/replay, atomic decision
update and rollback, old archived delta retained, utility/earmark gates.
F: movement/allocation fan-out, Gifts100000+50000-120000=30000; resource2000000-
300000 debt-1500000 claims=200000; signed+60000/-10000 withresources50000 deficit10000;
precutoffzero effect, retired funds, original/current samecycle and midcycle fallback,
target600000-100000/5dates=100000, source/settings/observation drift null availability,
actual member reads/service/anon/outsider denial, pagination/filter-bound cursors.
D: backing/release/reallocate, cutoff/plan/receipt guards, occurrence duplicate IDs,
exact correction links/combined rollback, retired source, incomplete resource block.
Primary adds two-connection last50000 funding race and occurrence-key race plus
end-to-end member fixture with all three modules. Independent review after writers
finish, fresh full replay, no workflow or earlier migration edits, PR stacked on#38.
Pause after PR; no production activation/import/deploy/merge.
