---
version: 1
slug: "apps-dashboard-components-transactions-view-tsx"
primary_target: "apps/dashboard/components/transactions/transactions-view.tsx"
related_targets:
  - "apps/dashboard/DESIGN.md"
  - "apps/dashboard/app/globals.css"
---

# Transactions

## Scope

Household ledger browsing, classification, review, and spend treatment. The visual system is the shadcn foundation in `DESIGN.md`. Do not reintroduce Common Orbit, custom panels, or status-dot chrome.

## Audience and job

Gustav and Cara, at home, deciding what a movement actually was. Scan the newest rows, see the working category and who decided it, accept or correct it in place, and open one row when the source or the classifier needs checking.

## Constraints

Compose `components/ui` primitives. Category and treatment stay independent. Source facts stay source facts. The feed is paginated; history loads only on inspection. Provenance is secondary text, not a badge. No charts, budgets, or insights on this surface.

## Direction

The log owns the width and starts at the newest row. Filters sit in the page toolbar: search, account, category, All or Review, dates. The inspector is absent until a row is chosen, then takes the right column at `1024px` and a sheet below that. Accept is a tick on a JEV disagreement, not a dialog, and is omitted when JEV agrees with FinWise. Category change is a combobox on the row.
