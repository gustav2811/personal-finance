# Dashboard experience

Integrate budgeting into the existing dashboard as a household workspace. Use the
existing application typography, components and tokens. The [Smart Charts guide](../../docs/design/smart-charts/README.md)
governs chart work; SVGs are references only. This is an interaction design, not
a finished visual mockup or a new application shell.

## Budget overview

Header: explicit cycle dates, revision label, source freshness, and an 'Edit next
version' action. Default to the current cycle, not an ambiguous month number.

Lead with **Household available by purpose**, not individual account balances.
The household confirmed that shared expenses paid by different people are its
main budgeting difficulty. Show three distinct facts at the top:

- Funds: confirmed available by purpose, with provisional activity and deficits.
- Unassigned: reconciled resources not already claimed by a purpose or commitment;
  never the sum of bank balances plus unused credit.
- Liquidity: cash needed before the next income date, by payer account, with
  restricted/mortgage backing separated.

V1 liquidity shows reconciled account balances, card debt and an indicative list
of expected payments. A precise statement-driven payment forecast is deferred.

Keep forecast plan balance (expected cash income minus planned uses) below those
facts and label it 'Forecast'. It is not currently available money.

When opening balances or source activity are unresolved, say 'Needs reconciliation'
instead of rendering a confident green total. A large net worth is not evidence
of enough cash in the account that pays the next bill.

Main table:

| Purpose | Plan this cycle | Assigned | Spent | Available | Next need |
| --- | ---: | ---: | ---: | ---: | --- |
| Groceries | cycle target | actual assignment | recognised actual | backed remainder | next cycle |
| Gifts | contribution | actual assignment | recognised actual | accumulated balance | next occasion |
| Cara personal care | contribution | actual assignment | recognised actual | accumulated balance | no fixed date |
| Annual renewal | contribution needed | actual assignment | recognised actual | reserved balance | amount and due date |

Amounts in this wireframe are semantic labels, not real balances. A disclosure
shows original/revised plan, beneficiary, planned/actual payer and backing. Filter
Shared/Gustav/Cara without duplicating household totals. Separate commitment
rows (retirement, required mortgage, extra debt reduction) from consumption rows.

On each household purchase, show 'Shared expense · Paid by Cara' (or Gustav),
then its effect on the shared purpose. Payer comparisons never masquerade as
personal overspending. 'Move cash to paying account' is distinct from 'Move money
between budget purposes'.

## Fund detail

Answer: what is it for, what has been reserved, where is it, and what is due next?
Show opening balance, contributions, purchases/refunds, reallocations and closing
balance in a ledger. Every purchase drills into the canonical source and review
decision. Ordinary cash is pooled; do not require assigning groceries to a bank
account. Show restricted portions held in notice deposits, the utility wallet or
mortgage with an as-of date. 'Funded but not immediately accessible' is a valid state.

Use horizontal target bars for dated obligations and a contribution/spending
timeline for accumulating funds. Do not show one alarming monthly percentage
for a purchase intentionally paid from six months of saving. Indicate deficits
with text/icon as well as colour. Table values remain accessible without charts.

## Editing the plan

Clone current revision. Edit amounts, ownership, due dates and targets in a draft.
Show the full cash impact and a before/after diff, including category changes.
Choose 'this cycle' or 'next cycle'; publishing requires a reason and displays
the resulting revision. Overcommitted forecasts may be saved with a clear gap;
the 'fund' action cannot create unavailable resources. No surprise prorating.

Moving R300 already saved from entertainment to gifts displays both balances and
records one reallocation. It does not change recurring targets. If the user also
edits the plan, publish a version and apply the movement together. Revising a
future contribution does not move existing money unless explicitly chosen.

## Review actuals

Extend the existing transaction review with a small number of relevant questions:
category, whose expense, and purpose when ambiguous. Use a split editor
only for mixed purchases. Show confirmed versus provisional status and explain
why a row is excluded or awaiting allocation. Avoid forcing beneficiary questions
on clear, already-approved recurring matches.

High-value queues: unmatched movements; source changes affecting confirmed
balances; missing ownership; mixed purchases; utilities awaiting linkage; and
unallocated spending. Order by financial impact, not just model confidence.

## Payer cash calendar and history

An indicative cash calendar uses expected income and optional payment dates on
budget lines, plus account restrictions. Detailed card statements and settlement
support tracking are deferred. Transfers between Gustav and Cara can be inspected
as movements without linking each one to a purchase or inventing a spouse debt.

History has one plan-version selector. Compare original and current targets against
latest reviewed actuals. Explain 'We increased the groceries plan' separately from
'A corrected transaction changed actual spending'. The transaction's correction
trail is inspectable. Do not offer a frozen report or a close/restatement workflow
in v1; those require a demonstrated need and a separate design.

Implementation charts may use the reference grouped bars for original/revised/
actual comparisons and line treatment for fund balances. Reuse responsive chart
primitives; no embedded SVG charts, fixed 600px canvases or new font assumptions.
