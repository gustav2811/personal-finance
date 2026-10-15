---
version: 1
slug: "apps-dashboard-features-analysis-analysis-view-tsx"
primary_target: "apps/dashboard/features/analysis/analysis-view.tsx"
related_targets: []
---

# Analysis
Mode: Operate. Household financial exploration. Default: this month.

## Direction contract
THESIS: Four linked lenses on the same ledger: composition, time, flow, and comparison. No budgeting targets.
OWN-WORLD: Extend the utilities visual system: Geist, neutral surfaces, electric neon chart tokens, separated rounded segments, faded gradients and quiet axes.
STORY: Find what moved, isolate categories or accounts, then inspect the transactions behind each number.
FIRST VIEWPORT: A quiet Analysis header with one date control; four view tabs and one Refine disclosure; financial totals and the large chart immediately below. The breakdown shows seven leading contributors and a lossless Other group. Filters, currency, calculations and export live inside Refine. Date presets and custom dates live inside the date popover; provenance and calculation notes live in About this data.
FORM: User-pinned FinWise capability and layout references translated into the established dashboard world; code-led. No concept seed needed for the specified arrangement.
SIGNATURE: A category selection opens its exact filtered transactions; temporal cells narrow that selection to their period.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Completion evidence

- `apps/dashboard/features/analysis/README.md` records the four views, Johannesburg month defaults, in-workspace selection behavior, filter defaults, member RPC boundary, 100-row cursor pagination, repeated-cursor failure, demo mode, and conservative cash semantics.
- Checked `apps/dashboard/features/analysis/analysis-view.tsx`, `model.ts`, `queries.ts`, `apps/dashboard/lib/finance/transaction-queries.ts`, and `transaction-read.ts` against the operational claims.
- Checked `apps/dashboard/DESIGN.md`, `PRODUCT.md`, `docs/design/smart-charts/README.md`, and `docs/design/references/svg-reference/README.md` for the incumbent visual and chart contract.
- Token check: feature charts use `var(--chart-*)`, `type-*`, shadcn primitives, and inherited Geist SVG text. Existing fixed SVG drawing coordinates and label sizes are retained as implementation details; no pre-existing drift was repaired.
- Selection persistence is currently mount-scoped React state; it does not survive a full reload. This is recorded as a known behavior rather than silently claimed as durable persistence.

## Distill pass

User goal: make data the hero and remove overwhelming configuration from first glance. Preserve all four views, filters, export, keyboard access, and exact transaction drill-downs. Show seven contributors plus Other by default; expand on demand. Flow collapses each long tail using the same lossless grouping. No data or capabilities are removed. Browser automation is currently blocked by the embedded error-page URL policy, so visual verification is pending; unit and build checks cover functionality only.

Distill verification: production build, TypeScript, and 16 focused tests pass. Tests cover lossless signed/magnitude grouping, Other drill-down in breakdown and flow, hidden/default refinements, transfer inclusion, date presets, transaction search, and both bar-series pointer/keyboard period selection. Manual detector returned no findings. Independent reviewer: pass for code findings resolved; no visual approval. Fresh desktop/mobile inspection remains pending because the Browser Use URL policy blocks the embedded error page. The previous review captures must not be presented as the distilled page.
