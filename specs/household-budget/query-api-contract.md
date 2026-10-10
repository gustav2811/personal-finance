# Household budget query API

Status: Stage 5 public member-read contract. This is an authenticated read
surface, not a budget activation mechanism. The governing rules are
[behaviour](behaviour.md), [data and delivery](data-and-delivery.md), and the
[backend contract](backend-contract.md).

## Shared contract

The public functions below are `SECURITY DEFINER`, have a fixed schema-qualified
search path, and resolve the household from the verified authenticated caller.
They have `EXECUTE` only for `authenticated`; `anon`, `public`, and
`service_role` are denied. A caller never supplies `household_id`. Every result
is JSON and includes `calculation_version`, `household_id`, `as_of`,
`complete`, and `reasons` whenever monetary availability is present. Reads are
stable and must not insert, update, delete, or create a command receipt.

Money is an integer ZAR-cent value serialized as a decimal JSON string (for
example `"60000"`), never a JSON number. A nullable money value means that the
value is not safely known; it does not mean zero. Dates are ISO local dates in
the household's `Africa/Johannesburg` cycle: the 23rd is inclusive and the next
23rd is exclusive. Timestamps are ISO UTC instants. `reasons` is an array of
objects such as `{code, message?, source_ref?}`. Unknown source, stale
reconciliation, foreign currency, ambiguous ownership, and missing coverage
must be represented as `complete:false` with a reason, not guessed.

All list limits are integers from 1 through 200, default 50. Liquidity horizon
is an integer from 1 through 366, default 45. Invalid dates, ranges, filters,
limits, UUIDs, or cursors raise SQLSTATE `P0001` with a message beginning
`budget_invalid:`. Missing rows use `budget_not_found:`; an unauthorised
household uses `budget_forbidden:`. The exact error prefix is the stable client
contract; the suffix is diagnostic and must not be parsed for business meaning.

## Cursors

`p_cursor` is nullable text and is opaque to clients. The implementation may
encode a versioned JSON object as base64url, but clients must never construct or
decode it. It contains at least a cursor version, function name, household,
canonical filter, and the complete keyset sort tuple. A malformed, expired,
foreign-household, wrong-function, or filter-mismatched cursor raises
`budget_invalid:`. Ordering is deterministic and keyset-based; the final UUID
or source identity is always a tie-breaker. Changing a filter or order requires
a new cursor.

## Functions and result shapes

### `budget_get_overview_v1(p_cycle_start date, p_as_of timestamptz default now())`

Returns one object with `cycle_start`, `end_exclusive`,
`original_version_id`, `current_version_id`, `original_plan`, `current_plan`,
`funds`, `net_liquid_cents`, `net_claims_cents`, `positive_claims_cents`,
`deficit_cents`, `unassigned_cents`, `provisional_unassigned_cents`,
`forecast_gap_cents`, `restricted_resources`, `restricted_claims`,
`provenance`, and the shared fields. The current implementation does not add
separate top-level correction/source-link arrays to overview; those links are
available in actuals/fund entries and provenance.

Each plan has `version_id`, `state`, `starts_on_cycle`, `version_number`, and
`lines`. A line has its frozen label/category/beneficiary/payer, `kind`,
`contribution_cents`, optional `target_cents`, due/recurrence/funding fields,
and `source_references`. A target is an intention or suggested requirement; it
is not funded money and never increases `net_liquid_cents`. Each fund includes
the stable fund identity, historical label, signed `balance_cents`,
`liquid_cents`, `restricted_cents`, and claims/provenance. Restricted values
are shown separately and are not silently made spendable.

Example (synthetic):

```json
{"household_id":"00000000-0000-4000-8000-000000000001","calculation_version":"household-budget-v1","as_of":"2026-10-10T10:00:00Z","complete":true,"reasons":[],"cycle_start":"2026-09-23","end_exclusive":"2026-10-23","original_version_id":"00000000-0000-0000-0000-000000000101","current_version_id":"00000000-0000-0000-0000-000000000102","net_liquid_cents":"2000000","net_claims_cents":"1200000","positive_claims_cents":"1200000","deficit_cents":"0","unassigned_cents":"800000","forecast_gap_cents":"25000","funds":[{"fund_id":"00000000-0000-0000-0000-000000000201","name":"Gifts","balance_cents":"1500000","liquid_cents":"1200000","restricted_cents":"300000"}],"restricted_resources":[],"restricted_claims":[],"provenance":[]}
```

### `budget_get_fund_v1(p_fund_id uuid, p_from date, p_to date, p_cursor text default null, p_limit integer default 50)`

`p_from` is inclusive and `p_to` exclusive. Returns `fund`, `balances` (at the
requested end), `target`, `restricted_claims`, `entries`, `next_cursor`, and
shared fields. Entries are stable movements and allocation components, not a
parent transaction plus its components: each has `entry_id`, `occurred_on`,
`kind`, signed `amount_cents`, `balance_cents`, source/decision/correction
links, beneficiary, actual payer, and provenance. Entries include opening,
assignment, release, reallocation, purchase, and refund history. Historical
labels and retired funds remain readable.

```json
{"fund":{"fund_id":"00000000-0000-0000-0000-000000000201","name":"Gifts"},"balances":{"balance_cents":"1500000","liquid_cents":"1200000","restricted_cents":"300000"},"target":{"target_cents":"600000","funded_cents":"1500000","suggested_contribution_cents":"0"},"entries":[],"next_cursor":null,"complete":true,"reasons":[],"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

### `budget_list_versions_v1(p_cursor text default null, p_limit integer default 50)`

Returns `versions`, `next_cursor`, `calculation_version`, `household_id`, and
`as_of`. A version header contains
`version_id`, `state` (`draft` or `published`), `version_number`,
`starts_on_cycle`, `published_at`, `parent_version_id`, `calculation_version`,
`reason`, `source_references`, and `future_divergence`. Ordering is
`created_at DESC, id DESC`; the cursor carries both key values. Effective-cycle
fields remain payload data rather than the pagination order. Drafts are visible only to members of
their household.

```json
{"versions":[{"version_id":"00000000-0000-0000-0000-000000000102","state":"published","version_number":2,"starts_on_cycle":"2026-09-23","published_at":"2026-09-25T08:00:00Z","parent_version_id":"00000000-0000-0000-0000-000000000101","future_divergence":false}],"next_cursor":null,"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

### `budget_get_version_v1(p_version_id uuid)`

Returns the complete immutable header, with its `lines` nested inside `version`:
`version`, `version.lines`, `income_assumptions`, and `source_references`, plus
`calculation_version`, `household_id`, and `as_of`. The current implementation
does not add top-level `parent` or `history` keys; `parent_version_id` is in the
header. It never substitutes the current version or current fund labels.
Each amount remains a decimal string; optional target, due date, payer, account,
and provenance values may be null.

```json
{"version":{"version_id":"00000000-0000-0000-0000-000000000102","state":"published","starts_on_cycle":"2026-09-23","parent_version_id":"00000000-0000-0000-0000-000000000101","reason":"reviewed revision","lines":[],"income_assumptions":[],"source_references":[]},"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

### `budget_get_actuals_v1(p_filters jsonb, p_cursor text default null, p_limit integer default 50)`

`p_filters` is exactly `{from,to,beneficiary_scope?,beneficiary_member_id?,paid_by_member_id?}`.
Unknown keys, invalid combinations, or a member filter without `member` scope
raise `budget_invalid:`. Returns `entries`, `filtered_totals`,
`household_totals`, `next_cursor`, and shared fields. Totals are nested under
`by_group`, `by_beneficiary`, and `by_actual_payer`; `by_group` separates each
effect type, with both debt payment types grouped as `debt_commitment`. Payer
and beneficiary maps
are keyed by member (or `shared`/`unassigned`) and contain separate signed
amounts for consumption, contribution, debt commitment, refund, income,
financing, movement, and unresolved items. Linked refunds follow the original
allocation's beneficiary and payer in these totals, while entries preserve the
refund's recorded attribution and original-allocation link.
Entries are current reviewed allocation components only, with source identity,
allocation-set identity, correction/supersession identity, signed amount,
fund/effect, source snapshot/fingerprint, decision/treatment and provenance
links, and review status. Optional source, decision, correction and
member/account references are null when evidence does not exist; null is not an
inferred value.
Totals are returned under `filtered_totals` and `household_totals`, each with
`by_group`, `by_beneficiary`, and `by_actual_payer`. A split parent is never
counted in addition to its components. Filtered totals are a view, not a
replacement for unchanged household totals.

```json
{"entries":[{"source_transaction_id":"tx-synthetic-1","amount_cents":"-60000","effect_kind":"consumption","fund_id":"00000000-0000-0000-0000-000000000201","beneficiary_scope":"shared","paid_by_member_id":"00000000-0000-0000-0000-000000000011","attributed_beneficiary_scope":"shared","attributed_beneficiary_member_id":null,"attributed_payer_member_id":"00000000-0000-0000-0000-000000000011","source_snapshot":{},"supersedes_id":null}],"filtered_totals":{"by_group":{"consumption":"-60000"},"by_beneficiary":{"shared":{"consumption":"-60000"}},"by_actual_payer":{"00000000-0000-0000-0000-000000000011":{"consumption":"-60000"}}},"household_totals":{"by_group":{"consumption":"-60000"},"by_beneficiary":{"shared":{"consumption":"-60000"}},"by_actual_payer":{"00000000-0000-0000-0000-000000000011":{"consumption":"-60000"}}},"next_cursor":null,"complete":true,"reasons":[],"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

### `budget_get_review_queue_v1(p_cursor text default null, p_limit integer default 50)`

Returns `items` (also exposed as `entries`), `next_cursor`, and shared fields.
Each item has `review_key`, `kind`, `severity`, `occurred_on`, nullable
`source_transaction_id`, nullable `utility_entry_id`, nullable `account_id`,
nullable `fund_id`, nullable decimal-string `amount_cents`/`impact_cents`,
`reasons`, and `provenance`. Kinds cover unallocated post-cutover outflow,
allocation/source drift, needs-review allocation, missing reconciliation/
coverage/ownership, ambiguous pending, and ambiguous utility link. This is a
read of evidence; it never mutates source state or marks work reviewed.

```json
{"items":[{"review_key":"transaction:tx-synthetic-2","kind":"unallocated_outflow","severity":"high","occurred_on":"2026-10-01","source_transaction_id":"tx-synthetic-2","utility_entry_id":null,"account_id":null,"fund_id":null,"amount_cents":"-12500","impact_cents":"-12500","reasons":[{"code":"unallocated_outflow"}],"provenance":{}}],"next_cursor":null,"complete":false,"reasons":[{"code":"review_items_present"}],"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

### `budget_get_liquidity_v1(p_as_of timestamptz default now(), p_horizon_days integer default 45)`

Returns `accounts`, `card_debt_cents`, opaque `resources`,
`restricted_resources`, `restricted_claims`, `expected`, `forecast`, and shared
fields. The account/resource payload is the existing reconciled resource read;
cards are deducted exactly once and restrictions/claims are separate. The
forecast object has `horizon_days` and `entries`; where the complete query
implementation is enabled it additionally carries `through_date`,
`expected_income_cents`, `expected_payment_cents`,
`indicative_net_gap_cents`, and `uncertainty_reasons`. `expected` is only an
indicative forecast from frozen version facts: expected net income and line
payment due dates/accounts. It never forecasts from statements, future income,
credit, equity, or inferred balances.

```json
{"accounts":[],"card_debt_cents":"0","resources":{},"restricted_resources":[],"restricted_claims":[],"expected":[],"forecast":{"horizon_days":45,"through_date":"2026-11-24","entries":[],"expected_income_cents":"100000","expected_payment_cents":"0","indicative_net_gap_cents":"100000","uncertainty_reasons":["no_statement_forecast"]},"complete":true,"reasons":[],"calculation_version":"household-budget-v1","household_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-10T10:00:00Z"}
```

These reads describe observed and reviewed facts. Installing their migration,
running fixtures, or importing a draft does not establish a real budget. A
real budget remains `needs_reconciliation` until the cutover runbook resolves
the evidence gates and an explicitly authorised member executes audited
commands.
