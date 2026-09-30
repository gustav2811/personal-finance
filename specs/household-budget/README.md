# Household budgeting

Status: proposed design, not implemented or financially reconciled.
Date: 2026-09-29. Repository baseline: `master` at `9b61775`.

Revised after the household accepted the complexity review: nine proposed tables
replace the original 24-table model. The current files describe the smaller core;
the earlier table inventory and formal closing workflow are superseded.

## Recommendation

Build one household plan with immutable published revisions, an explicit ledger
of money assigned to purposes, and a separate cash-flow view for Gustav and Cara.
Categories describe purchases; funds describe money reserved for future purchases;
accounts describe where money is held. These are different things.

The budget is a point-in-time agreement. Changing its amounts, categories,
membership, ownership, funding rules, or allocation policy publishes a new
revision. Moving already-assigned money does not change recurring targets unless
explicitly requested. Spending changes actuals, not the agreement. Preserve both
the original plan and the revised plan when explaining a month.

This is for this household: shared and personal expenses, separate payers,
payroll deductions, giving, retirement, irregular spending, and reserves held
inside an access mortgage. Do not build a generic budgeting product or replace
the connected-account ingestion system.

## Read in order

1. [Evidence and household fit](evidence.md): spreadsheet, FinWise, live schema,
   research, and unresolved facts.
2. [Budget behaviour](behaviour.md): revisions, periods, funds, attribution,
   cash backing, and worked examples.
3. [Data and delivery](data-and-delivery.md): schema extension, commands,
   invariants, acceptance cases, and rollout.
4. [Dashboard experience](experience.md): the screens and decisions they support.
5. [Backend build plan](backend-build-plan.md): PR sequence, builder objectives,
   database/query scope and validation gates. Dashboard implementation is deferred.
6. [Backend implementation contract](backend-contract.md): concrete database,
   command and query contracts owned by the coordinating agent.

## Design decisions

- Use the 23rd–22nd cycle with explicit date labels and calendar-month reporting,
  confirmed by the household during this design.
- Centre the experience on household availability and expense attribution across
  different payers, the household's confirmed primary pain. A credit limit or
  an individual account balance is never the household spending allowance.
- Start a real funded budget at a reconciled cutover date. Historical source
  transactions can support analysis; they cannot prove historical fund balances.
- Keep personal care and clothing as accumulating funds, as requested, alongside
  gifts. Do not reset them monthly.
- Preserve the spreadsheet's planned payer assignments. Show contribution
  comparisons, but do not impose equal or income-proportional settlement.
- Show mortgage-backed reserves separately from immediately available cash.
  Neither property equity nor an unused borrowing facility is spendable savings.
- Use net bank income for cash funding. Payroll retirement and medical aid remain
  optional explanatory context, never deducted twice. A payroll subsystem is deferred.

## Small core and clear boundaries

1. Budget versions and lines own the agreement, including funding targets.
2. Stable funds represent purposes across cycles and plan revisions.
3. Reviewed transaction allocations own spending and beneficiary/payer attribution.
4. Fund movements own opening assignments, contributions and reallocations.
5. Account settings and reconciliations establish resources; narrow restricted
   earmarks handle notice savings, utility wallets and mortgage reserves.

Fund balances are derived from assignments and allocations. Purchases do not also
write a money journal. Ordinary cash is pooled instead of mapped to every fund.
Budget history is immutable; historical actuals use latest reviewed facts with
an audit trail. Formal close/restatement, multiple goals inside a fund, reimbursement
links and statement-level card workflows are deferred.

The research and design are complete enough to review. The open facts in
[evidence](evidence.md#facts-to-resolve-at-cutover) prevent activation of a
trustworthy opening budget, not further design work. No production data, Google
Sheet, FinWise budget, classifier mode, or application code was changed.
