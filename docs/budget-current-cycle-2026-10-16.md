# Current household budget decisions

Reviewed with the household on 16 October 2026. Applies to the cycle from
23 September through 22 October 2026. Production commands and their immutable
receipts are the financial record; this document explains the decisions.

## Agreement

- One shared household pot. Payer attribution does not create spouse debts.
- Expected net income: R87,399.24. Monthly plan: R84,541. Forecast remainder:
  R2,858.24, which is not a statement of available cash.
- Gustav's RA is paid from net income. Payroll deductions are not deducted a
  second time. A future SARS refund is not income until received.
- Shared fuel is R3,000; combined vehicle and household insurance is R1,222.
- Shared personal care is R800 and accumulates. Cara clothing accumulates.
- Electricity and water use ISMRT incurred charges. Wallet top-ups are asset
  movements. Wallet fees are separate actual costs.
- Sports includes R885 gym membership and variable activities. Entertainment
  excludes eating out and sport. Ordinary subscriptions are monthly.

## Recognition rules

- Internal account transfers do not create spending or income. Investment
  contributions are recognised once on the funding outflow, with the receiving
  investment leg excluded from a second recognition.
- Housekeeping has the agreed exception: the monthly R1,900 transfer into the
  Peggy savings account is the budget recognition point. Its receiving leg and
  later payments must not create a second housekeeping charge.
- The mortgage debit order comes from Cara's unconnected Standard Bank MYMO.
  The household explicitly authorised Gustav's R13,704 Discovery transfer as
  the payment proxy. The R13,703.32 loan receipt is not another budget expense.
  Loan-account interest and administration accruals affect the loan balance,
  not additional budget consumption.
- The separate R250 sent for an anticipated mortgage increase is advance
  funding held in the unconnected account. It is not confirmed extra principal
  repayment or interest expense. Neither it nor the R0.68 rounding remainder
  is asserted to be available cash from an unobserved account balance.
- Cara's R3,000 short-term savings transfer is provisionally general household
  savings, separately from her R3,000 TFSA contribution. No new recurring
  R3,000 plan allocation was added for general savings.
- Gifts use the gift purpose. Church coffee beans and WorshipTools are giving.
  JPO tickets for the household are entertainment; the mother's payment and
  reimbursement are pass-through movements.
- The duplicate R5 dormancy import is excluded. The single statement-confirmed
  debit remains recognised. Both source rows are retained.
- Statement evidence and finite user confirmations resolve nullable provider
  pending status without changing the provider fields. Explicit provider
  pending=true remains authoritative. Confirmation becomes invalid if its
  frozen account, date, amount or currency changes.

## Savings and activation

Emergency savings targets approximately R50,000 in Bank Zero, then additional
savings go into the access bond. Travel and gifts have dedicated accounts.
Car and home savings are held in the bond. Extra mortgage capital is protected
for extreme emergencies rather than ordinary spending. Giving accumulates in
its bank pots; account balances must not be added again as budget carry-over.

The approved estimated split of the R146,047.04 access-bond balance is emergency
R44,256.68, car R26,554.01, home R17,702.67 and protected capital R57,533.68.
This is a current estimate, not reconstructed historical contributions. Plan
evidence must not be presented as executed fund openings or liquid cash.

All 35 original current-cycle nullable-status rows are confirmed and allocated.
At the live check on 16 October, Checkers R285.37 (Groceries), Google One
R52.99 (Software & Services) and WorshipTools R356 (Donations) were pending.
Their source status remains pending; each is now a reservation against its
matched fund and household cash.

## Verification on 16 October

- Production migration `20261016121250_budget_initial_reconciliation_cutoff`
  corrects the initial cutoff, evidenced restricted-resource gate and separation
  of bank-source validation from utility-source validation.
- Production migration `20261016172303_budget_pending_reservations` exposes a
  working budget when known pending authorisations are the only remaining
  reconciliation findings. It keeps posted reconciliation status separate,
  reserves each known pending amount, and retains source, identity, freshness,
  and sign uncertainty as blockers.
- Published plan version 4 repairs the confirmed category matches for Groceries,
  Gustav subscriptions and Gustav God's money. Its monthly plan total remains
  R84,541.00. Pending reservations map to Groceries R6,000, subscriptions R700
  and giving R5,000 monthly allowances; the household reserve is R694.36.
- There are 143 current-cycle reviewed bank allocation sets. Their component
  totals all match their sources, with zero stale bank source fingerprints.
  Mortgage actuals are R13,704 after correcting the R250 advance funding.
- The 12 focused cutoff regressions pass. They include established-baseline
  revalidation, later reconciliation records, backdated imports, archive drift,
  explicit pending and unknown states, and restricted-capacity bounds.
- The full isolated database runner passes after the reservation change,
  including migration replay, statement-finality and heartbeat regressions,
  pending-versus-unknown semantics, and two-connection concurrency checks.
- Internal cutoff helpers are not executable by member, anonymous or service
  API roles. The audited reconciliation command is available to authenticated
  members and denied to anonymous callers.
- No opening fund movements or restricted earmarks were created. This makes the
  spending plan available with category allowance-versus-spend positions while
  unassigned and cash-backed fund balances remain distinct.
