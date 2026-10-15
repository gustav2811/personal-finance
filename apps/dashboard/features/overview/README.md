# Overview

Overview is the focused household budget landing page at `/`. It
surfaces electricity, groceries, eating out, fuel, and coffee for one active
budget period. The approved presentation is Orbit: five independent rings for
category budget usage, five directly labelled rows, and one selected category
timeline below the scan.

## Interaction and responsive behavior

The period control moves the whole page together through the existing household
cycle: 23rd through 22nd in `Africa/Johannesburg`. The active period is shown
in the Orbit centre. Open periods show days remaining; closed periods show
Complete; future periods show Upcoming. Electricity is selected on mount.

Selecting a ring or category row changes the shared detail timeline. The
timeline supports Cumulative and Daily measures, a date readout, chart date
selection, previous/next day inspection, keyboard activation, and an exact
period link to Utilities for electricity or Analysis for financial categories.
Selection is mount-scoped state and is not persisted across a full reload.

Desktop uses an instrument-and-list composition. Narrow containers centre a
compact instrument above all five rows; all headlines remain available without
horizontal scrolling. The timeline follows the rows and adapts to its
container. Reduced-motion users receive immediate selection changes.

## Data contract

The loader reads three sources in parallel through the authenticated browser
client:

- Finance member reads provide categories and cursor-paginated transactions for
  the selected period. The transaction pages are followed until their cursor
  is exhausted; a repeated cursor fails the load.
- Electricity reads bound the consumption ledger by `occurred_at`, falling back
  to `posted_at` only when the incurred date is missing, as Utilities does.
  Only ZAR debit `usage_charge` entries with `utility_type = electricity`
  contribute to incurred usage cost.
- Budget reads call `budget_get_overview_v1` with an as-of timestamp clamped to
  the period end, then follow cursor-paginated `budget_get_actuals_v1` pages.

Financial spend excludes archived, pending, transfer, and explicitly excluded
rows. Recognised `refund` and `card_refund` treatment natures offset spend.
Electricity excludes wallet deposits, wallet fees, and other utility charges.
The five categories are not a total household-spend measure.

## Budget and unknown-state rules

Remaining is sourced from the linked fund balance: liquid balance when the fund
has restricted money, otherwise balance. A category budget is only shown when
one unambiguous fund maps to that category, the budget response and actuals are
complete, and the actuals reconcile with displayed spend. Shared utilities,
multiple-category funds, missing mappings, future periods, source failures, and
unreconciled actuals stay unknown with an explanatory no-category-budget note.
The implementation does not turn a plan target or a shared balance into an invented allocation.

Open financial periods include spending through today. Electricity includes
known incurred usage through the last available closed day; missing usage days
are called out and cumulative totals stop after a gap. Zero, missing, stale,
and unavailable data remain distinct in the model and warnings.

## Visual contract

Orbit inherits the dashboard's Geist typography, neutral shadcn surfaces,
light/dark themes, and `var(--chart-1)` through `var(--chart-5)` palette. The
implemented saturated hues are mixed with the foreground for contrast. Rings
show each category's own budget usage, while the rows carry the authoritative
numeric reading. The timeline uses sparse guides, direct labels, a restrained
area fill for cumulative values, and rounded bars for daily values. No second
design system or new backend capability is part of this feature.

## Provenance and verification

The expandable About this budget period section states the 23rd–22nd period,
electricity and finance exclusions, shared/incomplete-fund handling, category
scope, warnings, and fetched timestamp. Demo mode is labelled as illustrative.

The production build and TypeScript checks pass for the implemented surface.
The four `overview-{desktop,mobile}-{dark,light}.jpg` captures are synthetic
mock evidence and do not prove authenticated live data. Independent review scored the budget calculation, category handoff, and
mobile-light capture fixes resolved. The release check covers 17 overview and 18 analysis tests, alongside the
existing budget and transaction suites.

Run `yarn test:overview`, `yarn test:analysis`, `yarn types`, and `yarn build`
from `apps/dashboard`. PR CI runs the overview suite automatically.
