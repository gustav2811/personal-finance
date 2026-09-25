---
version: 1
slug: "apps-dashboard-components-transactions-view-tsx"
primary_target: "apps/dashboard/components/transactions-view.tsx"
related_targets: ["apps/dashboard/app/globals.css"]
---

# Transactions

## Scope

Household ledger browsing, classification, review, and spend-treatment visibility. Operate mode. Localhost until a later production build.

## Audience and job

Gustav and Cara, at home, deciding what a movement actually was. The task is to scan the newest rows, see the working category and who decided it, accept or correct it, and open one row when the source or the classifier needs checking.

## Constraints

Inherit Common Orbit. Do not invent a new visual world. Category and treatment stay independent. Source facts stay source facts. The feed is paginated; history loads only on inspection. No charts, budgets, or insights.

## Direction contract

THESIS: The ledger is a reading log of household movements, each with a visible decision. It refuses the admin table of status pills and the modal editor.

OWN-WORLD: Common Orbit graphite, mint for a decision you made, amber for a JEV proposal that differs, blue for a FinWise observation, mono for dates and amounts, a date gutter like a logbook rule.

STORY: The visitor sees the newest movement and its working category, accepts a disagreement or corrects it in place, and moves to the next row. Opening a row reads the audit as a short timeline. The next transaction should always feel one gesture away. Reviewing must never trap the user in a transaction.

FIRST VIEWPORT: The log owns the width and starts at the newest row. A thin instrument bar sits above it: Search, Account, Category, All or Review, Date. The inspection plate is absent until a row is chosen, then takes the right third. Below 920px it is a sheet. Accept is a tick on a JEV disagreement, not a dialog, and is omitted when JEV agrees with FinWise.

FORM: Reading log inside the established observatory, inherited world, code-led, seed user-locked-prd.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Treatment editing is available in the plate. Event reconciliation is read-only. Production deploy is out of scope.
