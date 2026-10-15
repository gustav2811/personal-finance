# Analysis

Analysis is the read-only household ledger workspace at `/analysis`. It answers four related questions over one date window: where money moved, how it changed over time, how inflows connect to outflows, and which categories or periods explain the totals.

## Views

| View | Purpose | Primary interaction |
| --- | --- | --- |
| Breakdown | Rank movement by category, group, merchant, or account. | Select a ring segment or ranked row to open its transactions. |
| Trends | Compare money in and money out by day, week, or month. | Select a bar or period to open that period's transactions. |
| Cash flow | Show gross inflows and gross outflows as proportional ribbons. | Select a labelled flow to inspect its transactions. |
| Table | Compare each dimension across periods. | Select a row or cell to open the matching transactions. |

Every drill-down uses the active date, currency, and filters. The dialog can search merchant, description, account, and category, and CSV export uses the same filtered transaction set.

## Default view and progressive disclosure

The resting page puts the data first: one date control, four view tabs, a **Refine** disclosure, financial totals, and the chart. Date presets and custom dates live inside the date popover. Refine reveals category/group/merchant/account filters, currency, transfer and excluded-spend switches, applicable chart settings, and CSV export. Active filter counts remain visible when the panel is closed.

Breakdown starts with seven leading contributors and a lossless **Other** group. Its total includes every contributor; Other opens the exact underlying transactions. **Show all contributors** expands the ring and list. Cash flow collapses each long tail using the same grouping while preserving amount-proportional ribbons and exact drill-downs. The full table remains available as its own view. Optional period buttons live under **Explore periods**; provenance and calculation details live under **About this data**. No analytic capabilities or ledger data were removed.

The distill pass was verified through build, types, and component/presentation tests. Fresh desktop/mobile captures are pending because the embedded browser is blocked on its error-page URL policy; previous screenshots predate this pass and are not evidence of the new layout.

## Date and selection state

The initial range is the current budget cycle in `Africa/Johannesburg` (the 23rd through the 22nd). The budget-month shortcuts include the current cycle and can extend the range to three or six cycles. The range is sent as ledger dates, not browser-local timestamps.

View, dimension, measure, granularity, currency, and filter selections remain stable while the Analysis workspace is mounted and data is reloaded. They are not persisted across a full page reload or a new visit; add persistence only as a deliberate feature change.

## Filters and ledger rules

The controls support multi-select category, category group, merchant, and account filters, plus currency selection. Transfers and excluded spend are omitted by default and can be included explicitly. Pending and archived transactions remain omitted by default; pending is a ledger property even though it has no separate visible toggle in this surface. “Reset filters” clears the feature filters but leaves the selected currency unchanged.

Analysis uses the finance member RPCs through the authenticated browser client:

- `finance_get_transaction_filters_v1` supplies account and category options.
- `finance_list_transactions_v1` supplies the date-bounded ledger.

The loader requests 100 rows per page and follows every `nextCursor` until the window is complete. A repeated cursor fails the load rather than risking duplicate or looping data. Authorization remains the Supabase membership and row-level policy boundary; the dashboard never receives a service key. Demo mode uses the existing demo RPC adapter and labels the workspace “Demo data”.

Cash semantics are intentionally conservative:

- Positive amounts are directional money in, except credits whose treatment nature is exactly `refund` or `card_refund` (case-insensitive, with surrounding whitespace trimmed).
- Those two recognised natures offset net outflow; they are not inferred as earned income.
- Unknown or unmarked credits remain money in. The surface does not guess salary, investment income, or another earned-income type.
- Cash flow displays gross inflows, including recognised refunds, and gross outflows. A surplus or deficit balancing ribbon is visual accounting, not a transaction.

## Chart and visual contract

Charts use the incumbent dashboard system: Geist, shadcn neutral surfaces, `type-*` utilities, and `var(--chart-1)` through `var(--chart-5)` rather than feature hex values. The cash-flow view follows the [Chart 16 reference](../../../../docs/design/references/svg-reference/README.md#chart-16--cash-flow--sankey) and the precedence rules in [Smart Charts](../../../../docs/design/smart-charts/README.md); the reference SVG is not embedded. Recharts charts use `ChartContainer`, scale responsively, and keep narrow cash-flow content scrollable inside its own container.

The implementation check found token-compliant chart colors, inherited Geist SVG text, semantic type utilities, and shadcn primitives. Existing implementation details remain documented as-is: the cash-flow SVG has fixed internal geometry and literal SVG label sizes for its drawing coordinate system, while its outer layout is responsive. No pre-existing visual drift was repaired as part of this documentation change.


## Verification

Run `yarn types`, `yarn test:analysis`, and `yarn build` from the dashboard directory. Analysis tests cover financial aggregates, pagination, private snapshot boundaries, lossless contributor grouping, filter disclosure, transaction search, and pointer/keyboard chart drill-downs. The PR dashboard job runs the Analysis suite.

Fresh visual verification of the distilled layout remains pending; browser automation was unavailable during implementation. Prior screenshots show the earlier layout.

## Private local Supabase snapshot

A local preview can read a bounded household ledger snapshot from `.local/analysis-sample.json` in the dashboard directory. This file is git-ignored and explicitly excluded from Next deployment traces. It is never imported by browser code. The development endpoint filters it by the requested date range, returns `private, no-store`, and requires development mode plus both explicit flags. Without the file or opt-in, the demo falls back to its small synthetic fixture. Normal authenticated use continues to read the member RPCs.

Run this private preview on loopback only:

```sh
DASHBOARD_DEMO_MODE=true DASHBOARD_ANALYSIS_SAMPLE=true yarn dev --hostname 127.0.0.1 -p 3100
```

The snapshot is read-only and displays its Supabase provenance and capture date. It does not refresh from the database automatically. Host-header rejection is an additional check; loopback binding is the access boundary for the unauthenticated private preview.

## Transaction review

Select a transaction in any analysis drill-down to open the shared ledger review editor. Edits use the same member review RPC and revision checks as Transactions. Successful saves update the drill-down and charts immediately; closing flushes pending changes. Failed saves retain the draft with Retry and explicit Discard changes actions. Private snapshot rows remain read-only.
