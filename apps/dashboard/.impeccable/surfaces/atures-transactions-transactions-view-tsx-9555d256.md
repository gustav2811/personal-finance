---
version: 1
slug: "atures-transactions-transactions-view-tsx-9555d256"
primary_target: "apps/dashboard/features/transactions/transactions-view.tsx"
related_targets: ["apps/dashboard/DESIGN.md"]
---

# Transactions

## Scope

Household ledger browsing, classification, and inspection. Operate mode.

## Audience and job

Gustav and Cara, at home. Scan the newest movement, see the working category, accept or correct it, and open one row only when the source or treatment needs checking.

## Constraints

The shadcn design system is the visual authority. No charts, budgets, or status-pill tables. Category and treatment stay independent. The row does not edit.

## Direction contract

THESIS: A quiet list of household movements, each with one working category. It refuses the status-pill admin table and the metric dashboard.

OWN-WORLD: Neutral shadcn surfaces. Electric cyan marks money in, shocking pink marks money out, electric blue marks review. Colour is never the only cue.

STORY: The visitor scans the newest movements, opens one dialog, sets the category, and moves to the next row. The row does not edit. Review is the same queue the database uses.

FIRST VIEWPORT: Title Transactions. Toolbar is All or Review, search, and a filter icon. The table owns the width. The row does not edit. Opening a row opens one dialog, with previous and next. Review mode moves to the next row after a category is saved.

FORM: Operational list inside the established design system, code-led, seed user-locked-brief.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Transfer and spend filters from the previous ledger are not on the first toolbar. Production deploy is out of scope.
