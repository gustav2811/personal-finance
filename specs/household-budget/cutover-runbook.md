# Household budget financial cutover runbook

This runbook starts only after the Stage 5 migration and database tests have
passed. Deployment is not financial activation. Structural migrations, test
fixtures, seeds, spreadsheet exports, and source imports must never silently
present real spendable totals.

## 0. Release gate

- [ ] Confirm the exact approved migration SHA, replay/upgrade result, pgTAP
  result, grants, RLS policies, function search paths, and query plans.
- [ ] Confirm all seven query RPCs are available to `authenticated` and denied
  to `anon`, `public`, and `service_role`.
- [ ] Confirm the dashboard/client has no service credential and no query is
  writing a command, allocation, reconciliation, or source row.
- [ ] Keep the household status `needs_reconciliation`; do not seed opening
  money or call member commands yet.

Stop if any migration, fixture, generated import, or read path creates a
spendable amount without an explicit reconciliation and activation command.

## 1. Resolve the evidence register

Record a source reference, date, owner, and reviewer for every item below. Do
not replace an unknown with a spreadsheet total or an inferred value.

- [ ] Reconcile each person's payroll net pay, deductions, benefits, medical
  aid, retirement treatment, and actual bank receipt. Resolve the net-pay bridge
  and all `MISMATCH`/`CHECK` observations.
- [ ] Confirm every line amount, beneficiary, actual/planned payer, cadence,
  currency, and any real contribution/reimbursement agreement. Attribution is
  not a spouse debt.
- [ ] Confirm included account ownership, household pool membership, currency,
  source coverage, last statement/activity timestamp, balance convention,
  freshness, and sign evidence.
- [ ] Reconcile card debt and settlement-account relationships. A purchase and
  its repayment must not be counted twice.
- [ ] Reconcile liquid, notice, mortgage-held, and redraw reserves from current
  statements; verify eligible redraw/access conditions. Old sheet balances and
  available equity are not proof of spendable money.
- [ ] Confirm electricity, water, and wallet device/account ownership, coverage,
  incurred dates, correction links, and whether top-ups and usage are distinct.
- [ ] Confirm annual due dates and targets (renewals, gifts, maintenance,
  travel), and whether car saving means replacement, maintenance, or both.
- [ ] Confirm transaction coverage for both spouses and utility coverage;
  archived rows are not evidence of complete coverage.

Stop and leave status `needs_reconciliation` if any item is unresolved,
foreign-currency money has no evidenced ZAR conversion, a source identity is
ambiguous, a balance is stale, or ownership/coverage is incomplete.

## 2. Draft import and review

1. Create a draft budget version with immutable source references to the
   reviewed plan. Preserve full line snapshots, 23rd cycle dates, beneficiary,
   payer, kind, target and due-date semantics. Do not publish it as a real
   operating plan yet.
2. Import only synthetic/local fixtures in test environments. For the real
   draft, use reviewed source references and the audited member command path;
   never insert rows through a structural migration or admin seed.
3. Query `budget_list_versions_v1` and `budget_get_version_v1`; check the full
   snapshot, parent/history, future divergence, frozen labels, and decimal
   money representation.
4. Query `budget_get_overview_v1` for a cycle beginning on the 23rd and for a
   date around the 22nd/23rd UTC/Johannesburg boundary. Verify original/current
   plan selection, fund targets versus funded balances, liquid/restricted split,
   cards deducted once, and completeness/reasons.
5. Query `budget_get_actuals_v1` with no filter and each agreed beneficiary and
   payer filter. Verify component-only totals, current reviewed facts, source
   and correction lineage, and separate household totals.
6. Query `budget_get_review_queue_v1`; resolve every post-cutover outflow,
   source/allocation drift, missing ownership/coverage/reconciliation, and
   ambiguous pending/utility link before treating actuals as complete.
7. Query `budget_get_liquidity_v1` for the chosen cutoff and horizon. Confirm
   observed/reconciled rows, restricted claims, card debt, and clearly labelled
   indicative income/payment due-date forecast. It must not contain statement
   forecasts, future income as cash, credit/equity, or inferred balances.

Stop if any result has an unexplained reason, non-deterministic pagination,
parent-plus-component double counting, a target presented as funded money, or a
source/correction link that cannot be followed.

## 3. Explicit cutover reconciliation

- [ ] Choose and record one explicit UTC cutoff and its Johannesburg local
  cycle date. Capture fresh balance observations and activity-through times.
- [ ] Reconcile all included accounts and cards against the coverage contract;
  record restrictions, eligible restricted resources, pending IDs included in
  the observation, utility coverage, and source fingerprints.
- [ ] Record a complete reconciliation only when every required account/source
  is covered and current. Prepare opening fund assignments from that recorded
  reconciliation; targets remain suggestions until assignments are executed.
- [ ] Review opening assignments and earmarks as a complete set. Confirm that
  restricted claims are inside fund balances, do not add net worth, and do not
  become liquid without a verified release/redraw.
- [ ] Re-run overview, fund, actuals, review queue, and liquidity queries at the
  same cutoff. Save result hashes/IDs and reviewer sign-off.

Stop if the newest reconciliation is incomplete, an account is stale, a fund is
negative without an agreed correction, or provisional availability is being
shown as confidently spendable.

## 4. Financial activation authorization

Activation requires an explicit recorded authorization by the household, after
the evidence register and reconciliation review are complete. Only then may the
deployed audited member commands create reviewed allocations, opening/assign
fund movements, earmarks, or corrections. Execute commands with idempotent
command IDs, expected version/reconciliation/source fingerprints, and preserve
the returned receipts. Re-query after each bounded batch and stop on any stale,
conflict, incomplete, or forbidden result.

Activation must not be inferred from publishing a version, inserting a fixture,
importing a spreadsheet, or obtaining a successful query response. Until this
authorization and command sequence succeeds, the UI/status remains
`needs_reconciliation` and no seeded total is the household's real spending
availability.

## 5. Recovery and rollback

There is no destructive rollback of financial history. If a migration or query
release fails, stop dependent release and use the normal forward migration/revert
PR process; never rewrite migration history or manually repair production.
If a financial fact is wrong, freeze the affected view, preserve the original
source and receipt, and append an audited correction/reconciliation with an
explicit reason and source reference. Re-run all seven reads and obtain review.
Do not delete allocations, movements, earmarks, versions, or source history and
do not hide a correction by changing a fixture. If coverage becomes stale or a
source drifts, expose provisional/incomplete availability and return to section
2/3 until corrected.

## Completion record

Attach the migration SHA, test results, evidence register references, cutoff,
reconciliation ID/fingerprint, reviewed query result hashes, activation
authorization, command receipts, reviewer names, and any remaining uncertainty.
Report backend deployment completion separately from financial cutover.
