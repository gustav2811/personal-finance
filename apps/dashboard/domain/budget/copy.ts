export const copy = {
  pageTitle: "Budget",
  pageDescription: "What is still spendable, who needs cash, and what we are agreeing to.",
  needsReconciliation: "We can't say yet",
  needsReconciliationDetail:
    "A trustworthy spending total waits until the missing facts are agreed.",
  availableByPurpose: "Available by purpose",
  availableByPurposeDetail: "Each purpose stands alone. Do not add it to unassigned cash.",
  seeEachPurpose: "Each row below.",
  unassigned: "Unassigned",
  unassignedDetail: "Reconciled money not already claimed by a purpose. Not a bank balance, and not unused credit.",
  liquidity: "Cash before the next income",
  liquidityDetail: "Where cash sits, and the card debt already counted once. Not the spending allowance.",
  forecast: "Forecast",
  forecastDetail: "Not currently available money.",
  notStatementForecast: "Not a statement forecast.",
  cardDebt: "Card debt",
  cardDebtDetail: "Counted once. A repayment is not a second expense.",
  noReconciledAccounts: "No reconciled accounts in this read.",
  plan: "Plan this cycle",
  assigned: "Assigned",
  assignedDetail: "Money moved into this purpose. Not this cycle's plan.",
  spent: "Spent",
  spentDetail: "Recognised this cycle. Not a spending limit for an accumulating fund.",
  available: "Available",
  nextNeed: "Next need",
  purposes: "Purposes",
  commitments: "Commitments",
  commitmentsDetail: "Retirement, required payments, and extra debt reduction. Not household consumption.",
  retired: "No current target",
  purchases: "Purchases this cycle",
  reviewPurchases: "Review purchases",
  purchase: "Purchase",
  transferNotPurchase: "A transfer is not a purchase.",
  purchasesDetail: "A shared expense stays shared whichever person paid.",
  householdTotal: "Household total",
  householdTotalDetail: "Filtering who benefited does not change this.",
  partialList: "This list is not the full cycle.",
  withheld: "—",
  deficit: "Deficit",
  staysInTheFund: "No fixed date. Unused money stays in the fund.",
  nextCycle: "Next cycle",
  suggestedNotAssigned: "Suggested, not assigned.",
  dueNow: "Due now",
  fundedNotAccessible: "Funded but not immediately accessible.",
  planUnchanged: "This does not change the plan.",
  cannotCreateMoney: "This cannot assign money the reconciliation does not back.",
  moveBetweenPurposes: "Move money between purposes",
  assignFromUnassigned: "Assign from unassigned",
  releaseToUnassigned: "Release to unassigned",
  assignReason: "Assign money to a purpose",
  releaseReason: "Release money from a purpose",
  reallocateReason: "Move money between purposes",
  moveCash: "Move cash to the paying account",
  moveCashDetail: "A transfer between accounts. Not a change to a purpose, and not sent from here.",
  editPlan: "Edit next version",
  publishReason: "Publishing needs a reason.",
  thisCycle: "This cycle",
  nextCycleChoice: "Next cycle",
  noPublishedPlan: "No published plan",
  revision: "Revision",
  asOf: "As of",
  whoseExpense: "Whose expense",
  household: "Household",
  shared: "Shared",
  originalPlan: "Original plan",
  revisedPlan: "Revised plan",
  beneficiary: "Beneficiary",
  plannedPayer: "Planned payer",
  actualPayer: "Paid by",
  expectedPayment: "Expected payment",
  rollover: "Rollover",
  reconcile: "Opening balances",
  spendQuestion: "What can we still spend?",
  cashQuestion: "Who needs money?",
  attentionQuestion: "What needs a decision?",
  agreementQuestion: "What are we agreeing to?",
  reviewNextCycle: "Review next cycle",
  decide: "Decide",
  agreeOpening: "Agree opening balances",
  balancesMayBeStale: "Balances may be out of date.",
  saved: "Saved.",
  accountSetUp: "Set up.",
  accountNotSetUp: "Not set up yet.",
  publishAgreement: "Publish this agreement",
  whatChanges: "What changes",
  nothingWouldChange: "Nothing would change yet.",
  cashInEachAccount: "Cash in each account",
  moreDecisions: "There are more on the decision list.",
  moveSavedMoney: "Move money already saved",
  moveSavedDetail: "Tick this only if money already saved should move as well. Publishing does not do that on its own.",
  nextCycleKeeps: "Next cycle keeps this agreement until you publish a change.",
  contributionDoesNotMove: "Changing a contribution does not move money already saved.",
  theseChangeAnswers: "These change what we can spend or who can pay.",
  nothingToDecide: "Nothing needs a decision before those answers.",
  decisionsUnread: "Decisions could not be read.",
  notInPayingAccount: "Money in a notice deposit or the mortgage is not in the account that pays.",
  stillSpendUnknown: "We can't say what is still spendable.",
  whoNeedsUnknown: "We can't say who needs money in their account.",
  whoPaid: "Who paid",
  notPersonalOverspending: "Who paid is not personal overspending.",
  backing: "Not the account that pays the bill.",
  expectedPayments: "Expected payments",
  alreadyApproved: "Already approved. Do not ask again.",
  mixedNeedsSplit: "A mixed purchase needs a split. One consumption line would be the wrong economics.",
  driftedNeedsSplit: "This purchase changed after you reviewed it. Do not replace it with one line.",
  refundNeedsLink: "A refund has to name the original purpose.",
  increasedPlan: "We increased the plan.",
  decreasedPlan: "We decreased the plan.",
  correctedSpend: "A corrected transaction changed the spend.",
  planChangeIsNotCorrection: "A plan change is not a corrected transaction.",
  restricted: "Restricted",
  somethingUnresolved: "Something required for a trustworthy total is unresolved.",
  numbersChanged: "The numbers changed. Look again before saving.",
  notAMember: "This Google account is not on the household budget.",
  couldNotRead: "The budget could not be read.",
  couldNotSave: "The budget could not save that.",
  retryOutstandingMovement: "The last movement may have landed. Retry it before starting another.",
  ledger: "Ledger",
  ledgerNotAvailable: "Reviewed ledger balance. Not available money.",
  signIn: "Sign in to keep this decision.",
} as const

export function sharedExpensePaidBy(name: string): string {
  return `Shared expense · Paid by ${name}`
}

export function planChangedSentence(name: string, direction: "increased" | "decreased"): string {
  return direction === "increased" ? `We increased the ${name} plan.` : `We decreased the ${name} plan.`
}

export function paidBySentence(name: string): string {
  return `Paid by ${name}. ${copy.notPersonalOverspending}`
}

export function personalExpense(beneficiary: string, payer: string | null): string {
  if (payer && payer !== beneficiary) return `${beneficiary}'s expense · Paid by ${payer}`
  return `${beneficiary}'s expense`
}

export function reasonSentence(code: string): string {
  switch (code) {
    case "cutover_missing":
      return "Opening balances have not been agreed."
    case "plan_missing":
      return "There is no agreed plan for this cycle."
    case "review_items_present":
      return "Some purchases still need a decision."
    case "allocation_needs_review":
      return "A purchase needs another look."
    case "source_fingerprint_drift":
      return "A purchase changed after you reviewed it."
    case "unallocated_outflow":
      return "Money left an account without a purpose."
    case "utilities_unverified":
      return "A utility charge is not confirmed."
    case "resource_balance_unknown":
      return "An account balance is missing."
    case "income_assumption_unknown":
      return "Expected income is not known."
    case "no_statement_forecast":
      return copy.notStatementForecast
    case "pending_activity_provisional":
      return "A pending movement is provisional. It is not available money."
    case "source_allocation_stale":
      return "A reviewed purchase changed and is provisional until confirmed."
    case "excluded_from_spend":
      return "Excluded from spend."
    default:
      return copy.somethingUnresolved
  }
}
