# Evidence and household fit

Read-only observations on 2026-09-29. Amounts below are observed plan values or
explicit illustrations, not new spending recommendations. This document is a
design record, not an import of private transactions or payslips.

This evidence is retained from the original research. The household subsequently
accepted a simpler implementation: the current behaviour/data documents supersede
the initial 24-table proposal. No new external reads were needed for that revision.

## Authority

The household confirmed during this review that the primary problem is knowing
what is available to spend across household balances, especially when one person
pays a household expense. Irregular costs are also difficult. They explicitly
selected the 23rd–22nd cycle with calendar-month reporting. The design therefore
prioritises pooled purpose balances with separate payer attribution and liquidity.

The [Family Budget spreadsheet](https://docs.google.com/spreadsheets/d/1cQJZykR8XiCRFRYCWiXB0ZxVYygyps25wrZ7U2eRtlY/edit)
is authoritative for current intentions, per the household's instruction.
Its calculated totals still require reconciliation. FinWise's old budget is
comparison evidence, not the plan to migrate. Supabase owns transaction facts
and household decisions; source labels are not automatically confirmed decisions.

Inspected spreadsheet ranges: `2026 >!A1:O65` and formulas `A1:F33`,
`Expenses!A1:O65`, `Investments!A1:O65` and formulas `H1:L15`,
`Cashflow!A1:M45`, `Gustav Income!A1:O65`, `Cara Income!A1:M45`,
and `Mortage Ledger!A1:O25`. Mortgage totals were visible but their full underlying
ledger was not audited. Do not import those totals as opening balances.

## What the sheet actually asks the system to do

| Observation | Design consequence |
| --- | --- |
| Expenses has Type, Paid by, Fixed/Variable, Category, Amount; Type distinguishes Combined/Gustav/Cara, and the Category cells are blank in the inspected expense rows | Beneficiary, payer, cadence, category and funding policy must be separate dimensions |
| Cara personal care and VW insurance belong to Cara but are paid by Gustav | Never infer beneficiary from bank-account owner |
| Gift sinking fund is R500; Cara clothing R500; Gustav/Cara personal care R500/R300 | Carry these balances across months, with personal ownership where applicable |
| Two fuel lines, two work-eats lines, multiple insurance lines | A single transaction category can support multiple budget lines through explicit dimensions |
| Coffee has its own R1,000 line | Preserve household vocabulary; do not fold it into eating out by default |
| Expenses total R48,358 includes medical aid and a sinking-fund contribution | This is a mixed planning total, not directly comparable with bank spending |
| Investments includes RA, TFSA, emergency/car/travel/home reserves, additional mortgage and giving | Separate retirement contributions, debt reduction, reserve funding, and gifts/donations paid out |
| Additional mortgage transfer formula sums extra mortgage R6,500 + emergency R5,000 + car R3,000 + home R2,000 = R16,500 | One physical transfer needs multiple purpose allocations; only R6,500 is intended irreversible extra debt reduction |
| Mortgage ledger allocates one deposit across mortgage, emergency, car and home columns | Virtual funds already exist; make their balances and backing explicit |
| Cashflow has manual reimbursements and funding-account notes for trips, repairs and home purchases | Link reserve withdrawals, purchase allocations and repayments without counting each leg as spending |
| Shared expenses are paid about 79%/21%, while the sheet displays a different income ratio | Show payer burden and agreed responsibility independently; this alone does not establish a debt between spouses |

### Reconciliation failures to preserve, not paper over

`2026 >!C17` is a hard-coded 36,721; its net-income check displays `MISMATCH`.
The retirement add-back check also displays `MISMATCH`. The summary displays
R2,856.11 surplus while `Investments!I5` displays R80.32 not allocated in the
negative direction. They use different income/deduction paths. Neither is an
approved amount available to fund new goals.

Payroll retirement, employer benefits, medical aid and cash contributions appear
in several bridges. Preserve the concepts, replace hand-linked arithmetic with
typed cash/non-cash components, and reconcile net pay to bank receipts before
activating a budget. Do not resolve the spreadsheet's `MISMATCH` or `CHECK`
labels by assuming the author's intention.

## FinWise comparison

Read `get_overview`, `get_profile`, and `get_budget` for period `2026-09`.
Its actual interval is **23 August–22 September 2026**, timezone
Africa/Johannesburg, currency ZAR, basic mode, consolidated categories.

The expense table has R73,750 budgeted, R98,839.61 spent, R556.55 rollover and
R24,533.06 negative remaining. This is not evidence that the household overspent
its current spreadsheet budget by that amount: dates, categories, savings and
amounts differ.

- Gifts has rollover from March; clothing and personal care have none.
- Savings and investments are included among expense rows. Savings alone shows
  R22,024 spent against R13,500 planned. This mixes money movement with consumption.
- Coffee and vehicle expenses have spending but no budget amount.
- Water & Electricity reports zero spending in this period; that does not prove
  no utility usage, particularly with prepaid ISMRT charges in another schema.

These are observed mismatches in this configuration. They do not prove FinWise
cannot support a different setup, nor establish every frustration the household
has experienced. The proposed diagnosis is that category totals cannot express
all the household's purpose, ownership, timing and mortgage-reserve semantics.

## Supabase and repository baseline

Live project: `finance-data`. Read-only SQL inspected `information_schema.columns`
for `public` and `finance`, category catalogue, account semantics, and aggregate
transaction/treatment/event counts. No financial rows were modified.

- Canonical accounts are `public.accounts` (`account_id uuid`), transactions are
  `public.transactions` (`id text`). Do not assume the older logical spec's ID names.
- 7,196 transaction rows: 4,422 archived; 2,774 non-archived. Latest incurred date
  28 September 2026. There are 11 source-pending rows overall.
- Only 25 non-archived rows have an owned-category pointer; 2,772 have a source
  category. Missing owned confirmation is different from missing source labels.
- 47 owned categories exist, all active and with null `group_name` in this read.
- `finance.transaction_classifications`, `transaction_treatments`, source
  observations, household membership and financial-event tables already exist.
- Financial events contain no rows. Account semantics returned no populated
  role/owner scopes for the inspected accounts. Do not assume movement pairing
  or account ownership is ready merely because the tables exist.
- Accounts include cash, notice deposits, loans, credit, investments and rewards;
  some currencies are missing. Available credit and reward units cannot seed cash.
- The dashboard transaction surface can display proposals and source fallbacks.
  That review-oriented surface is not a safe confirmed-budget actuals engine.
- Utility facts live separately in `consumption.ledger_entries`, with incurred
  dates and correction semantics. They must not be counted alongside wallet
  top-ups as two expenses.

Local anchors: [owned data model](../finance-data/data-model.md),
[invariants](../finance-data/invariants.md),
[categorisation evidence](../../docs/categorisation.md),
[consumption model](../../docs/consumption-model.md), and migrations
`20260925182000_create_finance_decisions.sql`,
`20260925230000_finance_transaction_surface.sql`,
`20260926140000_household_security_boundary.sql`.
The existing classifier evidence supports leaving shadow mode in place.

## Research and choices

1. [YNAB: periodic expenses](https://www.ynab.com/blog/periodic-expenses)
   recommends setting aside money for irregular costs and distinguishes these
   from emergencies. Adopt the principle; for a near-term deadline divide the
   unfunded amount by remaining funding dates, not automatically by twelve.
2. [YNAB: targets](https://support.ynab.com/how-to-use-targets-rk5kkI9ks)
   distinguishes target behaviours. For this household explicitly model fixed
   contributions, refill-to-balance targets and dated obligations. A single
   rollover toggle is insufficient.
3. [CFPB: Your Money, Your Goals](https://www.consumerfinance.gov/consumer-tools/educator-tools/your-money-your-goals/toolkit/)
   provides separate savings-plan, bill-calendar and cash-flow tools. Adopt a
   due-date/payer cash forecast alongside the aggregate budget: an affordable
   month can still leave the paying account short on a particular day.
4. [CFPB: emergency funds](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/)
   treats emergency savings as a reserve for unplanned financial shocks. Keep
   it distinct from known annual bills and discretionary upgrades.
5. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
   documents the separate grants/policies boundary and view risks. Extend the
   existing household boundary; never give the dashboard a service credential.

The chosen design combines income planning with reconciled purpose allocation.
Percentage rules such as 50/30/20 are not the governing model: the household
already has more specific commitments and priorities. A full personal general
ledger is unnecessary; a ledger of fund assignments plus reviewed transaction
allocations is enough. Purchases are not copied into a second journal. These are
design judgements informed by the evidence, not externally
mandated rules.

## Facts to resolve at cutover

1. Budget cycle and primary friction are confirmed above. At cutover confirm any
   actual reimbursement agreement; expense attribution does not imply one.
2. Reconcile each net salary, payroll deductions and benefits; confirm cash versus
   payroll treatment of medical aid and retirement. Preserve source references.
3. Confirm which accounts belong to whom, which are in the funding pool, account
   currency, notice restrictions, balances and statement dates.
4. Reconcile opening reserves, including mortgage-held emergency/car/home amounts,
   against a current statement and verified redraw conditions. Old sheet summaries
   and the FinWise gifts rollover are not automatically cash-backed balances.
5. Confirm current line amounts from the spreadsheet, payer assignments and any
   desired contribution agreement. Do not invent a spouse settlement obligation.
6. List annual due dates and target amounts (gifts, renewals, maintenance, travel).
   Confirm whether car savings means replacement, maintenance, or both.
7. Confirm active transaction coverage for both spouses and utility coverage;
   archived counts are not proof of duplicate economic events.
