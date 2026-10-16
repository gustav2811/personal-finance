# Overview concepts — approved Orbit direction

The approved direction is implemented in the dashboard overview. This document
records the visual decision and the data contract that the implementation must
continue to honor.

[Composition explorations](overview-concepts/four-directions.png) ·
[Approved direction reference](overview-concepts/bolder-directions.png)

The images explore composition. Their illustrative chart values, rounded
percentages, icons and decorative rendering are not authoritative data or
changes to the shared design tokens. The text contract below governs behavior.

## Job

Let Gustav and Cara scan electricity usage cost, groceries, eating out, fuel,
and coffee spending, with budget remaining, for the active household budget
period. The overview is a focused landing page; Analysis and Budget retain
their detailed workspaces.

## Shared contract

- Use the existing budget cycle: 23rd through 22nd in Africa/Johannesburg.
  Date navigation changes every headline and chart together.
- Electricity is incurred usage cost in rands, using the usage date. Wallet
  deposits, wallet fees and other utility charges do not become electricity
  usage. Do not add bank top-ups to consumption charges.
- Show spending first, remaining budget second. Use the authoritative budget
  mapping and remaining calculation; do not silently substitute a target or
  invent a category allocation. Missing mapping stays unknown with an
  explanatory no-category-budget note.
- Preserve the incumbent Geist typography, neutral shadcn surfaces, chart
  palette and light/dark themes. Follow Utilities and Analysis chart grammar:
  direct labels, sparse guides, focused selection, rounded bars, and restrained
  area fills. No second design system.
- Example values in visual concepts are illustrative, not live household data.
- Do not imply these five categories represent total household spending.

## Approved composition: Orbit

Orbit uses five independent concentric rings for electricity, groceries, eating
out, fuel and coffee. Each ring shows the proportion used of that category's
own budget; rings never represent shares of a combined household total. The
category rows beside the instrument repeat the direct labels, spent amount,
remaining amount, and budget context so the graphic is not the only decoding
path. Electricity is selected initially. Selecting a ring or row changes the
single detail timeline below without hiding the other four headlines.

The centre of the instrument carries the active period and its state: days
left for the current period, Complete for a closed period, or Upcoming for a
future period. A selected ring is the strongest accent; unavailable budget
data leaves the ring unfilled and explains the state in the accessible label
and provenance area.

The detail timeline carries the approved Current direction's useful temporal
detail. It supports cumulative and daily measures, a selected date readout,
keyboard day inspection, and links to the exact period in Utilities or
Analysis. The timeline is a focused lens, not five competing mini-charts.

## Responsive behavior

On desktop, the Orbit instrument and the five category rows share a two-column
composition. On narrow containers, the instrument becomes a compact centred
summary above the five fully visible rows; rows remain selectable without
horizontal scrolling. The detail timeline follows the rows. The existing
dashboard shell, Geist type, neutral surfaces, light/dark themes, and chart
tokens remain the visual system at both sizes.

## Rejected alternatives

- **Household Pulse.** Five large spending figures and remaining budget bars
  across the top with one selected-category chart below. Round one rejected it
  as too conservative.
- **Energy First.** A large electricity cost and usage-cost chart beside four
  compact financial category rows. It gives electricity more attention than
  the other stated priorities.
- **Budget Runway.** Five expansive rows with aligned amounts and proportional
  spend/remaining bars. It emphasizes comparison over daily patterns.
- **Five Windows.** Electricity occupies a larger panel with four smaller
  category panels. It creates greater visual competition on small screens.
- **Colourfield.** Five full-height coloured budget columns. It was rejected
  because it loses the temporal patterns that distinguish Current.

## Round-two context

[Desktop and mobile explorations](overview-concepts/bolder-directions.png) were
used to choose the approved direction. Current supplied the temporal-detail
idea; Orbit supplied the scan. The implementation combines them without
introducing a new palette, navigation model, or backend capability.

## Implementation limits and provenance

- The overview reads member-scoped finance transactions and categories through
  the existing authenticated browser client, electricity usage from the
  consumption ledger, and budget position plus period actuals through the
  member budget RPCs. The dashboard never receives a service key.
- `budget_get_overview_v1` is read with an as-of timestamp clamped to the
  selected period end. `budget_get_actuals_v1` is cursor-paginated to
  completion, with repeated cursors treated as a load error.
- Electricity includes only ZAR debit `usage_charge` ledger entries dated in
  the selected period. Wallet top-ups, wallet fees, and other utility charges
  are excluded. Financial spending excludes archived, pending, transfer, and
  explicitly excluded rows, and recognised refunds offset spending.
- Remaining is derived from the linked fund's authoritative balance (liquid
  balance when restricted funds exist). Shared, incomplete, missing, future,
  or unreconciled mappings remain unknown and are explained; the overview
  does not estimate a category allocation.
- Financial charts are complete through today for an open period; electricity
  uses known incurred usage through the last available closed day and marks
  gaps. Cumulative values stop after a missing electricity day rather than
  bridging unknown data.
- The five categories are a focused household view, not total household
  spending. The provenance disclosure exposes the period, exclusions, warnings,
  and read timestamp.
- Current validation includes the production build and TypeScript checks. The
  captured `overview-{desktop,mobile}-{dark,light}.jpg` files are synthetic
  mock evidence, not authenticated live-data proof. Independent review scored the three reported fixes resolved;
  all 18 focused tests passed.

## Superseded round-one interaction notes

The first round established useful interaction constraints that remain in the
implemented surface: electricity is selected initially; touch and keyboard
selection provide the same detail; reduced motion uses an immediate state
change; exceeded budgets say “over” without clipping the amount; and links to
Utilities or Analysis preserve the selected period.
