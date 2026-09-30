# Command API execution contract

Primary-owned refinement of backend-contract.md for PR 1b, stacked on #37.
Build six member RPCs: create/update fund, save draft, publish, configure account,
and record reconciliation. No assignments, spending review, dashboard or workflows.

## Shared helper signatures (foundation migration)

All helpers use search_path=pg_temp, qualified relations, explicit external EXECUTE
revokes, and UTC for timestamp serialization. They are private. Public wrappers
are SECURITY DEFINER, revoke PUBLIC/anon/service_role before granting authenticated.
JSON required/optional keys are validated at every object level. Optional absent
and explicit JSON null normalize to the same value, including nested line fields.
Unknown keys fail budget_invalid. Whitespace on descriptive text is trimmed.
UUID/date/timestamp/amount input types are strings; monetary output uses strings.
Revision and publication tokens use JSON integer numbers in 0..9007199254740991.
Malformed, missing or out-of-range scalar values raise P0001 budget_invalid.

- budget_fail(text,text) returns void: P0001, message prefix + ': ' + detail.
- budget_validate_object(jsonb,text[] required,text[] optional) returns void.
- budget_text(jsonb,text key,boolean nullable default false) returns text;
  nonempty trimmed strings; optional null permitted only when nullable.
- budget_uuid(jsonb,text key,boolean nullable default false) returns uuid.
- budget_date(jsonb,text key,boolean nullable default false) returns date;
  exact YYYY-MM-DD, reject infinity and invalid dates.
- budget_timestamp(jsonb,text key,boolean nullable default false) returns timestamptz;
  ISO8601 with explicit Z/offset, finite, normalized under UTC.
- budget_integer(jsonb,text key,bigint min,bigint max,
  boolean nullable default false) returns bigint; JSON integer number only.
- budget_cents(jsonb,text key,boolean nullable default false) returns bigint;
  decimal integer strings only; normalize sign/leading zeros through bigint::text.
- budget_boolean(jsonb,text key) returns boolean; JSON boolean only.
- budget_hash(jsonb) returns text: SHA256 of canonical jsonb UTF8 text.
- budget_actor_member(uuid household) returns uuid (household_members.id).
- budget_begin_command(uuid command,text kind,jsonb canonical_payload) returns jsonb;
  require trusted request role authenticated and nonnull auth.uid, use existing
  binding/resolver, lock household before domain writes, resolve actor, then
  compare receipt kind/payload. Return exact stored result on replay, else SQL NULL.
  Different kind/payload raises budget_conflict. Replay precedes stale-state checks.
- budget_finish_command(uuid command,text kind,jsonb canonical_payload,jsonb result)
  returns jsonb; insert completed receipt last with inferred household/actor. No
  pending receipt, no exception swallowing. Failed domain work rolls back receipt.
- budget_settings_snapshot(uuid household,uuid account) returns jsonb or SQL NULL;
  all operational settings including owner/inclusion/class/settlement/freshness/
  sign/evidence/utility-device, excluding actor_id/updated_at. Retain household/id.
- budget_settings_fingerprint(uuid household,uuid account) returns text or SQL NULL;
  hash settings snapshot.
- budget_snapshot_snapshot(uuid household,uuid account,date) returns jsonb or SQL NULL;
  household/id/date, amount_cents as string (preserve invalid fractional/nonfinite
  evidence rather than silently rounding), currency_code, observed_at, source_system,
  sync_run_id. Normalize integral numeric cents to integer text. No balance defaults.
- budget_snapshot_fingerprint(uuid household,uuid account,date) returns text or NULL;
  hash snapshot. Same key replaced amount/currency/source timestamp changes hash.

All normalization is stateless and happens BEFORE begin_command; database existence,
expected revision/fingerprint and current-state checks happen AFTER replay lookup.
Each wrapper canonicalizes every allowed key and scalar before comparing receipts.
Arrays retain order; optional fields always appear as JSON null after normalization.
Authenticated caller context is inferred, never supplied by payload. JSON null
checks use IS DISTINCT FROM; NOT IN with missing/null cannot validate a required key.

Foundation also owns create/update fund and configure-account RPCs from the main
contract, and its own command security/replay tests. Fund update changes only name
and status, preserving beneficiary/history. Account configuration validates owned
account, owner member and settlement account; included tracking_only is invalid,
excluded requires reason, known sign requires evidence. New settings require null
expected fingerprint; edits require current fingerprint. Receipt result contains
settings_fingerprint plus before/after operational facts for auditing. Fingerprint
excludes audit fields so identical settings have identical operational fingerprints.

## Plan commands (plan migration)

Use the main contract payloads and every budget_lines column. Required line keys:
stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,
funding_behaviour,recurrence,rollover_policy. All other line columns named in the
main contract are nullable optional keys (exclude id/household_id/version_id).
Validate enums, amounts and target/due requirements before writing. Referenced
fund/member/category/payment-account must be same-household; new draft lines use
active funds. Store supplied historical name/category/group snapshots; do not
refresh their labels during replay or publication. Income entry keys are exactly
member_id,expected_net_cents,expected_on,provenance; nonnegative cents, owned member.
Source-reference entries exactly source,reference (both nonempty strings).

Save is a full atomic replacement: new revision=1; existing draft requires exact
revision, increments once, updates header AND deletes/reinserts lines in one RPC.
Retain existing line row IDs for matching stable_line_id; stable_line_id/fund IDs
survive cloning. A new draft with parent references a same-household published
version; no automatic cloning or invented default values. Household lock then draft
lock; stale drafts/publications never partially edit. Missing cross-household IDs
raise budget_not_found or budget_forbidden without reading foreign facts.
Publication requires draft state, exact draft revision/parent and household latest
number. Assign next number once, freeze header/lines, no resources/fund movements.
Warnings: return objects {code:'future_plan_divergence',version_id} for existing
published plans starting AFTER newly published starts_on_cycle. They remain full
independent snapshots. No warning required merely because two plans share a parent.
Same-cycle replacement is whole-cycle. Tests select original/current versions
with spec ordering (published timestamp at cycle start, fallback first publication;
current starts_on_cycle<=cycle then cycle descending/number descending).

## Reconciliation commands (reconciliation migration)

Input shape stays the main coverage schema exactly; reject unknown nested keys,
noninteger schema_version, duplicate accounts/pending IDs, invalid enum/type/date.
settings_fingerprint is optional/null only for status missing; all evidence fields
are nonempty strings. included requires date/fingerprint/activity_through to become
complete; absent evidence facts produce incomplete reasons, never fake defaults.
Pending IDs are canonical public.transactions.id values, same household/account.

Private functions owned here:
- budget_validate_coverage(jsonb) returns jsonb: stateless canonical input shape.
- budget_check_coverage(uuid household,jsonb canonical_coverage,timestamptz as_of)
  returns jsonb STABLE: {status,reasons,coverage_snapshot}. Single-statement MVCC
  snapshot; enrich account entries with server-owned settings_snapshot and
  snapshot_snapshot (or JSON null), preserve expected input fingerprints/evidence.
  Freeze current nonarchived inventory (id list sorted), pending source facts and
  evidenced normalized_cash_cents/normalized_debt_cents strings (otherwise JSON null).
- budget_reconciliation_state(uuid household,uuid reconciliation,
  timestamptz checked_at) returns jsonb STABLE: revalidate frozen fingerprints,
  inventory, pending source facts and freshness without updating history; return
  {status,reasons,reconciliation_fingerprint}. A stored incomplete record stays
  incomplete; improved evidence requires a new audited reconciliation. No public grant. Future funding/read
  APIs must use this check rather than trusting the persisted historic status.

Record status is derived from this checker; input cannot contain status, household,
actor, frozen snapshots or inventory. Incomplete records are valid audited evidence.
Structural malformed input fails budget_invalid; foreign account/pending references
fail budget_forbidden. Missing/extra owned inventory, missing settings/observations,
stale fingerprints, missing timestamps, unknown sign/currency, noninteger/out-of-
range cents, and contradictory cash/debt convention all make status incomplete.
Inventory lists every current nonarchived account once, including excluded accounts.
An empty inventory remains incomplete evidence (`inventory_empty`).
Excluded must match excluded settings and nonempty exclusion reason; no balance
needed for excluded accounts. status missing always incomplete. Liquid uses
cash_signed; card uses debt_positive (raw>=0) or debt_negative (raw<=0). Normalize
cash/debt into frozen strings only when evidenced; never set missing values to 0.
Observation household/account/date match; account and observation currency are
ZAR exactly; observed_at<=as_of and within
freshness_hours. activity_through<=as_of and requires evidence; don't infer covered
activity from a date alone. Source timestamps fall back through effective_at,
posted_at, occurred_on (explicit UTC midnight), then the source date timestamp.
as_of must be finite and not future. Revalidation also
uses checked_at for freshness and prevents a query checked before recorded as_of.

Until later source/restricted integrations, included restricted/mortgage accounts
make status incomplete (restricted_resources_unverified). Utility status verified
or unknown stays incomplete (utilities_unverified); only explicit not_required with
evidence permits completeness. Explicit restricted eligibility is frozen evidence,
not spendable resources: if supplied, integer nonnegative cents + nonempty evidence;
restricted-deposit limit cannot exceed nonnegative raw balance. Do not manufacture
mortgage redraw from equity or credit headroom. Pending included IDs need owned
source rows and evidence, freeze amount/date/account/pending/archive facts for
later drift checks. Positive forecasts never create resources.

Store coverage_snapshot as enriched checker output: schema_version=1, accounts,
utility_coverage,evidence plus server-owned inventory. Preserve original expected
fingerprints even for incomplete records. Reconciliation fingerprint hashes its
id/as_of/cutover plus enriched frozen coverage. Exact command replay returns original
result even if source later changes; reconciliation_state detects current drift.
Opening cutoff is nullable date <=as_of's Johannesburg date. Only a complete
reconciliation establishes the first nonnull cutoff; later nonnull cutoff values
must match that established date. A null cutoff never resets the existing cutoff.
No fund movement or financial activation in this PR.

## Verification and publication

Use synthetic isolated PostgreSQL fixtures, member RPCs under real role/JWT context,
exact P0001 prefixes, real receipt replay after changed revision/source, malformed
payload and cross-household rejection, atomic rollback, final forced deferred
constraints, and a two-connection same-command/stale-revision race. Leave all prior
migrations and both workflow files unchanged. Stacked base is schema branch #37;
existing CI runs after retarget to master once predecessors merge. Pause after PR.
