# Household design system

The dashboard UI is shadcn/ui, installed from the official registry (`radix-nova`, neutral, Lucide, CSS variables). Do not invent a second component library or restyle primitives with a private palette.

The companion Figma file is the [shadcn/ui design system](https://www.figma.com/community/file/1203061493325953101). Components in `components/ui` are the code implementation of that system. Extend them; do not redraw them.

## Where things live

```text
components/ui/          shadcn registry source only
components/shell/       app shell, sidebar, auth, providers, theme
components/patterns/    domain-neutral: PageHeader, Section, DateField, RangeControl, DataGate
domain/consumption/     energy and money charts, source list, series helpers
features/overview/      page, queries.ts
features/energy/
features/money/
features/sources/
features/transactions/  ledger feed, inline category, inspector
lib/supabase/           browser client and generated database types
lib/format/             date and money
app/dev/ui              dev-only proving ground. 404 in production.
```

Dependency direction:

```text
ui
   ↑
patterns
   ↑
features
   ↑
routes

shell may use ui and patterns
ui must never import shell or features
patterns must never import features or domain
domain may use ui, not features
features must not import another feature's internals
```

`components/ui` is owned source. Modify a primitive if the registry behaviour is wrong. Never put feature behaviour there. Add a missing primitive with the CLI, from `apps/dashboard`, when a feature needs it. Do not install the catalogue ahead of use.

```bash
npx shadcn@latest add <name>
```

## Tokens

Components use semantic tokens only: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-1` … `chart-5`.

Generic status colour is `success`, `warning`, `info`, and `destructive`. A feature maps its own vocabulary onto those tokens. Do not add finance states such as `state-confirmed` to the global theme until more than one feature shares them.

A component knows `warning`. It does not know a hex. Both `:root` and `.dark` define the same names. Theme toggle is system / light / dark via `next-themes`.

Base surfaces stay the shadcn neutral tokens. Do not retint `background`, `primary`, `muted`, or `sidebar`.

Accent and chart colour comes from one palette, Electric Neon Dreams. Use the scale, not a one-off hex:

```text
shocking-pink    chart-1
violet-ray       chart-2
electric-blue    chart-3
deep-sky-blue    chart-4
electric-cyan    chart-5
```

Steps are `50` through `950`. `500` is the swatch. Charts point at those `500`s.

`blue` and `cyan` are namespaced as `electric-blue` and `electric-cyan`. Do not declare `--color-blue-*` or `--color-cyan-*`. Those names override Tailwind's default scales.

## Type

Use the utilities, not one-off sizes:

```text
type-display
type-page-title
type-section-title
type-body
type-body-small
type-label
type-caption
type-numeric
```

Sans (Geist) is the UI face. `font-mono` is for identifiers and technical metadata only. Dates and amounts use `type-numeric` (tabular figures), not monospace. Do not default to uppercase tracked microcopy.

## Density, radius, elevation

Default controls are the registry sizes (`h-8` default, `h-7` sm). Transaction rows stay at least 48px. Radius comes from `--radius`. Shadows are for popover, dropdown, dialog, sheet, and combobox — not for ordinary cards. Prefer a border and a surface step.

## Shell

`AppShell` owns auth, the sidebar, and theme. It does not load page data. Each feature exports `getXData()` / `loadXData()` and a feature-specific type. `DataGate` takes that loader. `load` must be stable: a module function or `useCallback`. An inline function refetches on every render. Do not add fields to a shared dashboard bag. Pages own their header and filters. The sidebar does not host range controls. Membership is `finance.household_members`, checked for presentation through `finance_caller_membership_v1`. Row-level policies remain the authorization boundary.

`lib/supabase/database.types.ts` is generated. Do not edit it by hand. Regenerate from the finance-data project for `public`, `consumption`, and `finance`. Full row aliases and the dashboard projections live in `lib/supabase/rows.ts`. `finance_caller_membership_v1` is in this PR's migration and is not on the remote database yet, so the generated file does not include it. The call site asserts that name until the migration is applied and types are regenerated.

Operational reads name their columns. Do not use `select("*")` on feeds the dashboard renders. A new column, especially metadata or a source blob, must be opted into. `count` queries select `id` with `head: true`.

```text
Household
  Overview        /
  Money           /money
  Transactions    /transactions
Home
  Energy          /energy
Record
  Sources         /sources
```

Accounts and Settings are not built. Add them as sidebar items when the destination exists. Do not ship disabled placeholders.

Desktop: persistent sidebar. Collapse to icons with the trigger. Mobile: the sidebar primitive opens a sheet.

## Page shape

```text
PageHeader
optional toolbar
content
```

`PageHeader` takes `title`, `description`, optional `breadcrumbs`, optional `actions`. Operational titles, not editorial headlines.

## States

A state is not a badge by default.

```text
row provenance     secondary text, coloured with a state token
sync failure       Alert
small filter chip  Badge or ToggleGroup, when the control is a filter
```

Money in and money out are signed and named for screen readers. Colour is not the only cue.

## Lists vs tables

Tables (`components/ui/table`) when columns are compared: readings, ledger entries, sources, ingestion.

Transactions are a compact table: date, merchant, account, category, amount. The row does not edit. Opening a row opens one dialog for category and treatment, with previous and next. Review mode moves to the next row after a category is saved. Icons carry account type, pending, and transfer. Do not put Accept or a category picker on every row. Review is the database queue: disagreement, an unmatched proposal, no category, abstention, or failure. Agreement is quiet.

## Feedback

Optimistic overlay, inline pending (`aria-busy` on the row), inline error, Undo in the dialog. No success modal. Do not disable the page while one row saves.

## Motion and access

Keep the behaviour that comes with the primitive: keyboard, focus ring, labels, ARIA. Reduced motion is global in `globals.css`. Do not add looping decoration.

## Charts

Recharts through `ChartContainer`. Colours are `var(--chart-1)` … `var(--chart-5)`, set on the chart config. Do not hardcode series colours in a feature.

## Do not

```text
fork a primitive that already exists
add hex colours in a feature component
build a one-off button or input
turn every state into a badge
turn every section into a card
put page filters in the sidebar
couple a domain fact to a literal colour
select * on an operational feed
```
