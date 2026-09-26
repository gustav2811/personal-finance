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

OWN-WORLD: Neutral shadcn surfaces, Geist, tabular amounts, and semantic success, warning, info, and destructive used only as captions. The electric palette stays off this page.

STORY: The visitor sees the newest movement, changes the category in place, and moves on. Opening a row reads source and treatment. Review is one toggle, not a queue.

FIRST VIEWPORT: Title Transactions. One toolbar: search, account, All or Review. The list owns the width and starts at the newest row. The inspector is absent until a row is chosen, then a right column above 1024px and a sheet below. Accept appears only when JEV differs.

FORM: Operational list inside the established design system, code-led, seed user-locked-brief.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Transfer and spend filters from the previous ledger are not on the first toolbar. Production deploy is out of scope.
