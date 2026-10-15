---
version: 1
slug: "apps-dashboard-features-overview-overview-view-tsx"
primary_target: "apps/dashboard/features/overview/overview-view.tsx"
related_targets:
  - "apps/dashboard/features/overview/queries.ts"
  - "apps/dashboard/domain/overview/model.ts"
  - "apps/dashboard/domain/overview/charts.tsx"
---

# Overview

Mode: Operate. Focused household budget scan with selected-category detail.
Approved direction: Orbit's five independent budget rings paired with the
Current direction's selected timeline detail.

## Direction contract

THESIS: Make five priority categories scannable in one budget period while
keeping daily and cumulative movement available for one focused category.
OWN-WORLD: Follow Utilities and Analysis: Geist, neutral shadcn surfaces,
light/dark themes, existing chart tokens, sparse guides, direct labels, and
responsive containers. Saturated chart hues are mixed with the foreground for
contrast.
STORY: Read the period state in the Orbit centre, scan each category's spent
and remaining values, select a ring or row, then inspect its timeline or open
the exact period in Utilities or Analysis.
FIRST VIEWPORT: Overview header and 23rd–22nd period control; Orbit centre;
five category rows; selected timeline below; quiet provenance disclosure last.
SIGNATURE: Five concentric arcs are independent category budgets, never shares
of a total. The selected category's timeline supplies the temporal detail.
FINISH: Build and TypeScript checks pass. Synthetic desktop/mobile light/dark
captures exist as mock evidence. Independent review scored the three reported fixes resolved; 18 focused tests passed.

## Contracts and limits

- All headline and chart values use the selected Africa/Johannesburg budget
  period. Current, historical, and future periods expose their respective
  state rather than silently defaulting to the current period.
- Electricity is incurred ZAR usage cost from debit `usage_charge` ledger rows;
  wallet top-ups, wallet fees, and other utility charges are excluded.
- Finance reads use member-scoped category and transaction RPCs with cursor
  pagination. Archived, pending, transfer, and explicitly excluded rows do
  not contribute to spend; recognised refunds offset it.
- Budget position uses the member budget overview and period actuals RPCs.
  Remaining comes from the linked fund balance. Shared, incomplete, missing,
  future, or unreconciled mappings stay unknown and explain why.
- The five categories are not total household spending. The About disclosure
  carries exclusions, warnings, and the fetched timestamp.

## Visual implementation notes

The ring chart uses the existing Recharts `ChartContainer` and chart variables.
Each arc is selectable by pointer and keyboard when a usable budget exists;
the row remains an alternate labelled control. The timeline uses Recharts
area/step cumulative or rounded daily bars, a date readout, a reference cursor,
and previous/next day controls. Motion is disabled under reduced-motion.

The desktop layout is a two-column instrument/list composition. At narrow
container widths the instrument is centred and compact, followed by all five
rows and the timeline. Existing shell and shared component styles remain the
source of truth.

## Verification and evidence

The production build and TypeScript checks passed for the implemented overview.
`overview-{desktop,mobile}-{dark,light}.jpg` are synthetic mock captures and
must not be described as authenticated live-data verification. Independent
review scored the budget calculation, category handoff, and mobile-light capture
fixes resolved; all 18 focused tests passed.
