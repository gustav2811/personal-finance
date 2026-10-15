# Household UI system extraction

Reviewed 15 October 2026 against the working tree, then refreshed after rebasing
onto `origin/master` at `0c8da8c`, including merged Overview, Analysis, Utilities,
and transaction-review work. Scope: dashboard
patterns, feature UI, chart UI, theme, and documentation. Registry primitives,
generated database types, Workers, and finance schema were left closed.

## Verdict

Keep the existing system. It already has a coherent foundation: Geist, neutral
shadcn surfaces, one runtime theme, explicit status colours, shared headers and
sections, and separated domain charts. Creating another library or token layer
would make future builds harder. The valuable asset is a documented, executable
set of household compositions built on that foundation.

The main waste is duplicated composition and lifecycle code, not a shortage of
primitives. Some page-level designs legitimately need their own geometry; forcing
the orbit, Sankey, and transaction editor into one configurable panel would add
complexity without reuse.

## Extracted and migrated

| Pattern | Evidence | Result |
| --- | --- | --- |
| FactGrid | Fund and liquidity fact tiles; electricity supporting stats | One typed composition, dt/dd semantics, existing 2/3-column and compact layouts; all three consumers migrated. Fund/liquidity previously put paragraphs in a dl. |
| ChartEmpty | Seven chart/utility no-data branches | Shared footprint; original titles, descriptions, and empty conditions retained. |
| ChartTooltipSurface | Six custom tooltips across budget and consumption | One surface/elevation definition; original guards, payload handling, and formatted content retained. Standard tooltips still use ChartTooltipContent. |
| Executable reference | Existing `/dev/ui` primitive gallery | Shared page/section compositions, fact variants, chart states, real range control, existing utility fixtures. Login-free in development demo mode; still 404 in production. |

No new tokens were needed. `app/globals.css` remains authoritative. Smart Charts
is visual reference material; its JSON is not a second runtime theme.

## Duplication and slop still worth addressing

| Priority | Evidence | Next step |
| --- | --- | --- |
| 1 | Eight budget roots (`overview-view`, `liquidity-view`, `fund-view`, `history-view`, `review-view`, `cutover-view`, `agreement-view`, `plan-editor`) duplicate request state/effects. Overview does not clear its previous error on reload. | Design one resource hook with cancellation, explicit status, reload, and retained-data policy. Keep domain projection outside it. Migrate one simple reader, then one mutation-driven view; test failure → retry → success and overlapping requests. Do not force these into today's basic DataGate. |
| 1 | `features/budget/transaction-budget.tsx` returns null when review is required but source amount/fingerprint is missing. | Restore an explicit unresolved state and verify the source-data cases. This is a behavior issue, recorded here rather than changed during extraction. |
| 2 | `features/transactions/transactions-view.tsx` opens dialogs from a focusable table row with key handlers; the merchant has no native action. Analysis already has a named button for this purpose. | Put a named native trigger in the merchant cell; keep row-click convenience. Verify announcement, Enter/Space, and focus return. |
| 2 | `features/transactions/inspector.tsx` repeats its label/control grid for description, notes, and category. | Extract a feature-local InspectorField. Its fixed label width should not become a global household form rule. |
| 3 | `domain/budget/target-bar`, `purpose-target`, and `plan-capacity` repeat track/fill/marker geometry. | Consider a local MoneyScale drawing primitive while retaining financial labels, uncertainty, and target semantics in each component. |
| 3 | `features/overview/overview.module.css` and `domain/overview/charts.module.css` repeat base caption/numeric styles alongside useful container-relative instrument type. | Reuse type utilities for ordinary copy; preserve responsive chart/instrument sizing. Do not tokenize every SVG coordinate or font size. |
| 3 | `domain/consumption/energy-chart.tsx` has no dashboard caller found; current utilities use MtdChart and MonthBars. | Confirm external usage, then remove the retired implementation in a focused cleanup. It is not another supported screen template. |
| 3 | Source/Wallet/DataGate messages expose schema, role, and read-policy details in normal household flows. | Use a plain user-facing failure plus recovery; keep diagnostics in development/logging. Preserve partial-data explanations. |

The large Analysis workspace also owns controls, export, drill-down, and several
visualizations in one file. Split those responsibilities locally when modifying
them. Do not publish its filter/summary controls as a universal API before another
feature has the same interaction contract.

## The asset to grow

Use `components/patterns/README.md` as the composition index and `/dev/ui` as its
rendered counterpart. Add future examples there, using small explicitly labelled
fixtures. A new household screen should usually compose PageHeader, controls,
Section, a few domain-specific visuals, and explicit data states. It should not
need a new shell, generic widget registry, chart factory, or parallel theme.

Preserve the existing boundaries: routes assemble features; features own reads
and decisions; domain owns projections/visuals; patterns own repeated neutral
composition; registry UI owns primitives. Domain visuals may use neutral patterns
as well as primitives. No backend changes are required by this extraction.

## Verification for this extraction

- TypeScript passed before extraction and after migration.
- All 99 existing budget tests passed; the focused FactGrid semantic regression
  test passed (`yarn tsx --test components/patterns/fact-grid.spec.tsx`).
- Impeccable's mechanical detector returned no findings for the extracted UI.
- Browser inspection covered the fixture reference at desktop and 390px widths
  in both themes. The checked widths had no document overflow; the fact lists
  exposed matching terms/descriptions. Shared range controls stayed in sync.
- Light-theme warning text was mixed with the foreground token for stronger
  contrast; the status palette itself was preserved.
- Independent review found no functional or semantic regression in the
  extraction. Authenticated live financial data and production deployment were
  outside this verification; existing development fixtures provided the UI data.

## Documentation refresh after rebase

`apps/dashboard/DESIGN.md` now records the implemented visual system in the
canonical eight-section format, with extracted light/dark tokens. The chosen
direction is Household observatory: calm, clear, data-led, flat and restrained,
with neutral surfaces and bright data accents. Its v2 `.impeccable/design.json`
sidecar contains ten portable component previews. These previews describe visual
treatment; they do not replace registry interactions or React components.

Engineering constraints moved to `apps/dashboard/ARCHITECTURE.md`; the pattern
index and live fixture gallery remain the implementation entry points. No new
palette or runtime theme was introduced. Upstream fixes for utility navigation,
Overview ledger fallback reads, and transaction discard handling were retained.

The original pre-rebase state remains in the named Git stash. Five generated
JavaScript files that duplicated TypeScript route/feature files were moved to
`/tmp/household-rebase-generated-js` to prevent ambiguous route/module resolution;
the stash also retains their original contents.

Final post-rebase verification passed: production build, TypeScript, 99 budget
checks, 17 Overview checks, 18 Analysis checks (re-run after removing generated
module ambiguity), 26 transaction checks, and the FactGrid semantic regression.
The documentation's canonical section order, sidecar structure, portable snippet
shape, and local links also passed validation. Independent review confirmed the
documentation against runtime tokens and the key upstream conflict resolutions.
