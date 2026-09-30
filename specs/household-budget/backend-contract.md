# Backend implementation contract v1

Parent-owned executable decisions for the backend build. Product authority remains
behaviour.md and data-and-delivery.md. SQL names use snake_case. Builders must
escalate contradictions rather than silently change this contract.

## Shared representation and security

All ten new tables live in finance. Every table has household_id uuid NOT NULL,
FK to households, RLS member SELECT, and no authenticated/anon direct write grants.
UUID entity IDs default gen_random_uuid(); all IDs have UNIQUE(household_id,id)
where referenced. No financial FK cascades. New amounts are bigint cents.
JSON amounts are signed decimal strings; reject floating JSON numbers for amounts.
Scope values are shared/member, with member UUID required only for member scope.
Member IDs refer to finance.household_members.id, not auth_user_id.
Every optional reference must still match household when present.

Public member commands have signature (p_command_id uuid,p_payload jsonb) RETURNS
jsonb, SECURITY DEFINER, search_path=pg_temp, schema-qualified object names,
explicit authenticated caller binding/check. PUBLIC/anon/service_role EXECUTE
revoked; authenticated granted. Internal finance helpers have no external EXECUTE.
Read wrappers have explicit membership checks, no service-role bypass and no writes.
The existing privileged ingestion functions retain their existing grants.

Stable errors use SQLSTATE P0001 and messages starting one of: budget_invalid,
budget_forbidden, budget_stale, budget_conflict, budget_incomplete,
budget_insufficient, budget_not_found. SQL FK/CHECK errors remain database errors.
Reject unknown top-level payload keys; distinguish omitted optional values and
explicit null consistently by canonicalizing the payload before receipt comparison.

Lock household first for each command. Resolve actor to household member ID.
`finance.budget_begin_command(p_command_id,p_kind,p_payload)` RETURNS jsonb:
bind caller, lock household, canonicalize/validate command shape, compare any
receipt; return stored result if replay, otherwise SQL NULL. Per-command argument
validation remains the command's responsibility. Changed kind/payload fails.
`finance.budget_finish_command(p_command_id,p_kind,p_payload,p_result)` RETURNS
jsonb stores the completed receipt with inferred household/actor and returns result.
No empty/in-progress receipt persists. Entire RPC runs in one DB transaction.

## Tables

All unspecified NOT NULL audit timestamps default now(). Actors are UUID member
references with household matching. Header/detail rows retain household for FKs.

### funds

id, household_id, name text nonempty, beneficiary_scope text, beneficiary_member_id
uuid nullable, status text active/retired default active, created_at timestamptz,
created_by uuid. Balance is derived. Renaming/retirement is audited in command
receipts; neither changes prior version or allocation labels.

### budget_versions

id, household_id, version_number bigint nullable until publication, parent_version_id
uuid nullable, state draft/published default draft, draft_revision bigint default 1,
starts_on_cycle date day=23, published_at timestamptz nullable, actor_id uuid,
reason text, calculation_version text default 'household-budget-v1',
income_assumptions jsonb default [] array, source_references jsonb default [] array,
created_at timestamptz. Unique(household_id,version_number) for published numbers.
Published requires number/time/nonempty reason. Published headers cannot update
or delete. Published versions are full snapshots. Draft parent is nullable on first
publication; parent must be published and older than the new publication.
Drafts have no publication number or timestamp; published numbers are positive.
Line mutations lock their parent version before checking publication state so a
concurrent publication cannot admit a late edit.

### budget_lines

id, household_id, version_id uuid, stable_line_id uuid, fund_id uuid, name text,
category_id uuid nullable, category_name_snapshot text nullable,
group_name_snapshot text nullable, beneficiary_scope/member_id,
planned_payer_member_id uuid nullable, kind consumption/contribution/debt_commitment,
contribution_cents bigint >=0, funding_behaviour cycle_allowance/accumulating/
target_by_date/reserve_target, target_cents bigint nullable >=0, due_on date nullable,
recurrence text cycle/annual/once, rollover_policy text carry/release_explicit,
expected_payment_on date nullable, expected_payment_account_id uuid nullable,
match_category_id uuid nullable. Unique(version_id,stable_line_id),
Unique(version_id,fund_id). target_by_date requires target/due date; reserve_target
requires target. Published version line INSERT/UPDATE/DELETE denied. No matching DSL.

### budget_allocation_sets

id, household_id, transaction_id text nullable, utility_entry_id uuid nullable,
source_snapshot jsonb object, source_fingerprint text nonempty,
source_amount_cents bigint, occurred_on date, revision_number bigint positive,
supersedes_id uuid nullable, status current/needs_review/superseded,
actor_id uuid, recorded_at timestamptz, command_id uuid,
classification_id uuid nullable, treatment_id uuid nullable,
evidence jsonb object default {}. Exactly one source. Unique live source where
status IN(current,needs_review), separately for transaction and utility. Unique
source/revision. Immutable except status transition current->needs_review/superseded
or needs_review->superseded; superseded terminal. Components/sets never delete.
Utility inserts denied until owned-device/entry constraints exist in PR4.
The first source revision is 1 with no predecessor; later revisions require an
explicit supersedes_id pointing to an earlier revision of that same source.

### budget_allocations

id, household_id, set_id uuid, ordinal integer >=0, amount_cents bigint,
fund_id uuid nullable, category_id uuid nullable, category_name_snapshot text nullable,
beneficiary_scope/member_id, paid_by_member_id uuid nullable,
payment_account_id uuid nullable, effect_kind consumption/contribution/
required_debt_payment/extra_debt_payment/refund/income/financing/movement/unresolved,
original_refund_allocation_id uuid nullable, opening_refund_reason text nullable,
financial_event_id uuid nullable. Unique(set_id,ordinal). Negative nonzero and fund
required for consumption/contribution/debt effects; positive and fund required for
refund with original link or explicit opening-period refund reason. Original refund
must target same purpose and outflow allocation. No fund delta for other kinds.
Zero amounts permitted only for zero-effect kinds. Components immutable. Enforce
aggregate split sum=header amount at transaction end with deferred constraint trigger.
Require at least one component, including when the source amount is zero. Complete
the command receipt after inserting components; a completed receipt closes its
set against additional component inserts.
Mixed signs require nonempty evidence.receipt_reference at command validation.
Supersession links must refer to earlier revision of same source; no cycles.

### fund_movements

id, household_id, from_fund_id uuid nullable, to_fund_id uuid nullable,
amount_cents bigint >0, kind opening/assign/release/reallocate, effective_on date,
recorded_at timestamptz, actor_id uuid, command_id uuid, budget_version_id uuid nullable,
reconciliation_id uuid nullable, correction_of uuid nullable, reason text nonempty,
funding_occurrence_key text nullable, correction_role text nullable reversal/replacement.
Opening/assign null->fund; release fund->null; reallocate distinct fund->fund.
Unique(household_id,funding_occurrence_key) WHERE key IS NOT NULL AND correction_role
IS NULL. Correction unique original/reversal so same original cannot reverse twice.
Rows append-only. A correction receipt can contain two linked rows.
Correction reference and role must be supplied together. A correction refers to
an original movement, never another correction. A reversal preserves the amount
and effective date and swaps endpoints; a replacement requires that original's
reversal in the same command. Each original permits at most one reversal and one
replacement.

### budget_account_settings

household_id, account_id uuid PK, owner_scope/owner_member_id, included boolean,
exclusion_reason text nullable (required if excluded), resource_class text liquid/
restricted/mortgage/card/tracking_only, settlement_account_id uuid nullable,
usual_due_day integer nullable 1..31, freshness_hours integer positive,
transaction_sign_convention text outflow_negative/outflow_positive/unknown,
sign_evidence text nullable (required if known), utility_device_id uuid nullable,
updated_at timestamptz, actor_id uuid. included tracking_only invalid. Utility device
reference enabled only in PR4. Same household source account required.

### budget_reconciliations

id, household_id, as_of timestamptz, actor_id uuid, status complete/incomplete,
coverage_snapshot jsonb object, opening_fund_cutover date nullable, notes text,
recorded_at timestamptz. Immutable. Command derives status; client cannot force it.
Only first established opening cutoff permitted; later opening corrections reference
same cutoff, never restart fund history. Coverage schema defined below.

### fund_earmarks

id, household_id, fund_id uuid, restricted_account_id uuid,
amount_cents bigint nonzero signed, effective_on date, recorded_at timestamptz,
actor_id uuid, command_id uuid, fund_movement_id uuid nullable,
allocation_id uuid nullable, financial_event_id uuid nullable,
reconciliation_id uuid nullable, correction_of uuid nullable, reason text nonempty.
Exactly one linkage type. Same-household and purpose/account checks. Immutable.
Constraints at commit: per-fund signed claims between 0 and greatest(balance,0),
per-account claims between 0 and verified eligible resources. Initial tables may
exist but positive claims are disabled until PR4 integrates validations/commands.

### budget_commands

household_id, command_id uuid, kind text nonempty, payload jsonb object,
actor_id uuid, result jsonb object, completed_at timestamptz.
PK(household_id,command_id). Append-only. Payload/result can contain references and
audit before/after facts, never credentials. Domain rows command_id use household
FK to receipt DEFERRABLE INITIALLY DEFERRED because receipt is completed last.

## Payloads for PR1

All UUID/date/timestamp JSON values are strings. All amount JSON values are strings.

- `budget_create_fund_v1`: {name,beneficiary_scope,beneficiary_member_id?} ->
  {fund_id}. Server creates UUID. `budget_update_fund_v1`:
  {fund_id,expected_name,expected_status,name,status} -> {fund_id,name,status}.
  This supplies retirement as well as rename without a second function.
- `budget_save_draft_v1`: {draft_id?,expected_draft_revision?,parent_version_id?,
  starts_on_cycle,reason,income_assumptions,source_references,lines} ->
  {version_id,draft_revision}. lines is array of full objects using table fields
  except id/household/version. stable_line_id supplied UUID, reused on clone.
  Existing draft requires matching revision; new draft rejects a supplied revision.
  Validate income array entries {member_id,expected_net_cents,expected_on,
  provenance}; provenance is nonempty text. Sources are {source,reference} objects.
- `budget_publish_v1`: {draft_id,expected_draft_revision,expected_parent_version_id?,
  expected_latest_version_number,reason} -> {version_id,version_number,warnings}.
  Expected number 0 for no published versions. Stale latest or parent rejects.
- `budget_configure_account_v1`: {account_id,expected_settings_fingerprint?,
  owner_scope,owner_member_id?,included,exclusion_reason?,resource_class,
  settlement_account_id?,usual_due_day?,freshness_hours,
  transaction_sign_convention,sign_evidence?} -> {account_id,settings_fingerprint}.
  New settings require null expected; existing require matching current fingerprint.
- `budget_record_reconciliation_v1`: {as_of,opening_fund_cutover?,coverage_snapshot,
  notes} -> {reconciliation_id,status,reasons,reconciliation_fingerprint}.

Coverage schema: {schema_version:1,accounts:[...],utility_coverage:{status:
not_required/verified/unknown,evidence:string},evidence:string}. Each account is
{account_id,status:included/excluded/missing,settings_fingerprint,
snapshot_date?,snapshot_fingerprint?,balance_convention:cash_signed/debt_positive/
debt_negative/unknown,activity_through?:timestamp,pending_included_ids:[],
eligible_restricted_cents?:string,restricted_evidence?:string,evidence:string}.
Inventory must name every current nonarchived household account exactly once.
Excluded entries must correspond to excluded settings and reason. Included entries
require verified ZAR observation and sign convention. For liquid use raw signed
cash; card debt normalize positive or negative source according to convention,
reject contradictory convention/sign as incomplete. Restricted/mortgage resource
eligibility requires explicit statement/redraw evidence and never implies liquid
cash. For restricted deposits eligibility <= nonnegative normalized balance;
mortgage eligibility is verified redraw cap, not equity or credit headroom.
Unknown utilities prevent completeness; not_required is an explicit fixture/source
coverage declaration, not a default. Snapshot fingerprints hash canonical frozen
values with sha256. Settings fingerprints similarly hash operational settings.
Referenced snapshot key must match account/household, currency=ZAR and integer cents.
as_of cannot be in future. activity_through cannot be later than as_of and needs
explicit observation evidence. Changed snapshot/settings/inventory invalidates
completeness immediately in query/command validation.

## PR2 helper/command contracts

`finance.budget_source_snapshot(p_household_id uuid,p_transaction_id text)` RETURNS
jsonb normalized source facts: {transaction_id,account_id,amount_cents,occurred_on,
source_system,original_amount,sign_convention,currency_code,pending,archived,
source_observation_id,source_fingerprint,classification_id,treatment_id,
financial_event_id,leg_role}. Missing sign evidence/currency/source ownership fails
review or appears unresolved; normalization never uses source category as authority.
Reject sub-cent source numeric amounts. Include direction, amount/date/account,
pending/archive and classification/treatment/event decision references in hash.

`finance.budget_fund_balances(p_household_id uuid,p_as_of date)` RETURNS TABLE
(fund_id uuid,balance_cents bigint,assigned_cents bigint,outflow_cents bigint,
refund_cents bigint,restricted_cents bigint). Source allocations with incurred date
before established opening cutoff report as historical actuals but have zero balance
delta. Movements use effective_on. Source archival never discards a reviewed delta.

`finance.budget_resources(p_household_id uuid,p_as_of timestamptz)` RETURNS jsonb:
{reconciliation_id,reconciliation_fingerprint,complete,reasons,net_liquid_cents,
restricted_resources,accounts,pending_adjustments}. Accounts require current
settings/observation fingerprints and freshness as of query. In PR2 any post-evidence
activity/pending/source drift produces incomplete; PR3 supplies conservative deltas.

`budget_move_funds_v1`: {kind,from_fund_id?,to_fund_id?,amount_cents,effective_on,
expected_version_id,expected_reconciliation_id,expected_reconciliation_fingerprint,
reason,funding_occurrence_key?,earmarks?:[]} -> {movement_id}. Validate current
published plan applies to effective cycle. Opening effective_on=cutoff and no prior
ordinary opening for that fund; positive assignment cannot exceed backed unassigned.
Release/reallocation cannot exceed source fund's nonnegative balance. Every fund
must be active for new assignments; retirement permits release of remaining money.
Cycle release is explicit and disallowed while source-purpose exposure is unresolved.

`budget_correct_movement_v1`: {movement_id,expected_reconciliation_id,
expected_reconciliation_fingerprint,reason,replacement?:{kind,from_fund_id?,
to_fund_id?,amount_cents,effective_on,budget_version_id?}} ->
{reversal_movement_id,replacement_movement_id?}. Reversal uses opposite endpoints
and corresponding valid kind; replacement preserves cutoff semantics if correcting
opening. Validate resultant backing/claims atomically. Receipt retries are harmless.

`budget_review_allocation_v1`: {transaction_id?,utility_entry_id?,
expected_current_set_id?,expected_source_fingerprint,components,evidence,
classification_id?,treatment_id?} -> {set_id,revision_number,allocation_ids}.
Exactly one source. Components use allocation columns except ID/set/household;
ordinals assigned in array order. Simple purchase is one component. Existing
confirmed treatment and classification required for bank fund effects; mixed splits
may provide reviewed categories with evidence.split_review_reason. Decisions must
be same-source/household/current. If user needs to update decisions, call existing
audited review helper within same transaction via a parent-frozen extension; don't
weaken validation. Utility decisions are explicit source-specific reviewed evidence.
For receiving mirrors/card settlements/internal movements require zero-effect kind.
Refund link includes explicit same fund original source. A changed allocation
supersedes whole set, no reversing purchase journal. Receipt comparisons precede
expected-current checks on replays. Before PR4, any earmarked fund correction or
outflow is rejected so claims cannot be stranded.

## PR3 exposure rules

Use observation activity_through and explicit included pending IDs as evidence,
not inferred from date similarity. For later source transactions, normalized
cash account flow adjusts cash; card outflow increases positive debt, card repayment
reduces debt. Transfers have zero purpose delta but affect payer account liquidity;
both verified legs net to zero resources. Missing counterpart/economic evidence
keeps completeness false. Do not add a transaction covered by the observation.
Late pre-observation/source-date drift is uncertainty requiring reconciliation.
Known pending purpose adjustment reduces its claim only when not already in
reviewed delta. Unknown or stale extra outflow adjusts unassigned conservatively.
Pending inclusion in observed resources suppresses only its resource adjustment,
not any still-needed purpose adjustment. Posted confirmation replaces pending
exposure via provider identity evidence or same canonical source identity. Different
IDs need explicit source/provider evidence; no heuristics. Ambiguous or unsupported
cases return provisional totals, complete=false and prevent assignment.
Positive future/pending income does not fund money; only confirmed/reconciled receipts.

## Read APIs

Public reads return JSON with decimal-string cents. All include calculation_version,
household_id, as_of, complete and reasons where monetary availability appears.

- `budget_get_overview_v1(p_cycle_start date,p_as_of timestamptz default now())`:
  cycle_start/end_exclusive, original_version_id/current_version_id, plan lines,
  funds, net_liquid_cents, net_claims_cents, positive_claims_cents, deficit_cents,
  unassigned_cents, provisional_unassigned_cents, forecast_gap_cents, provenance.
- `budget_get_fund_v1(p_fund_id uuid,p_from date,p_to date,p_cursor text default null,
  p_limit integer default 50)`: fund facts, balance, restricted/liquid portions,
  target suggestion, paginated entries and next_cursor. Inclusive from, exclusive to.
- `budget_list_versions_v1(p_cursor text default null,p_limit integer default 50)`.
- `budget_get_version_v1(p_version_id uuid)` full header+line snapshot.
- `budget_get_actuals_v1(p_filters jsonb,p_cursor text default null,p_limit integer
  default 50)`: filters exactly {from,to,beneficiary_scope?,beneficiary_member_id?,
  paid_by_member_id?}; component rows, filtered totals and separate household totals.
- `budget_get_review_queue_v1(p_cursor text default null,p_limit integer default 50)`.
- `budget_get_liquidity_v1(p_as_of timestamptz default now(),p_horizon_days integer
  default 45)`: observed resource account rows/card debt/restrictions plus indicative
  expected income/payment list; no statement-driven payment forecast promises.

Limits 1..200, horizon 1..366. Invalid filters/cursors fail budget_invalid. Keyset
cursor encodes sort keys and canonical filters and is validated against those
filters; never accept raw SQL/order expressions. Return corrections/source links.
Group consumption/contribution/debt separately. Filtered results cannot replace
or duplicate household totals. Preserve retired balances and historical labels.

PR4 utility/earmark payloads must be frozen by the primary after verifying the
owned device/account observation seam; existing money formulas remain unchanged.
