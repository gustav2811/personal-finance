# Household design system

The dashboard UI is shadcn/ui, installed from the official registry (`radix-nova`, neutral, Lucide, CSS variables). Do not invent a second component library or restyle primitives with a private palette.

The companion Figma file is the [shadcn/ui design system](https://www.figma.com/community/file/1203061493325953101). Components in `components/ui` are the code implementation of that system. Extend them; do not redraw them.

## Where things live

```text
components/ui/          registry primitives. Do not put domain components here.
components/app/         shell, page header, date field, range control
components/overview/    overview
components/energy/      energy
components/money/       money
components/sources/     sources
components/transactions/ transactions
lib/utils.ts            cn()
app/globals.css         Tailwind, semantic tokens, type utilities
```

Add a missing primitive with the CLI, from `apps/dashboard`:

```bash
npx shadcn@latest add <name>
```

## Tokens

Components use semantic tokens only: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-1` … `chart-5`.

Domain colour is a small extra layer, also tokens:

```text
success / warning / info
state-confirmed / state-proposed / state-source / state-pending / state-failed
```

A component knows `state-proposed`. It does not know a hex. Both `:root` and `.dark` define the same names. Theme toggle is system / light / dark via `next-themes`.

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

`AppShell` owns auth, the sidebar, and theme. It does not load page data. Overview, Energy, Money, and Sources fetch their own scope when mounted. Transactions never reads the consumption dashboard dataset. Pages own their header and filters. The sidebar does not host range controls. Membership is `finance.household_members`, checked for presentation through `finance_caller_membership_v1`. Row-level policies and review RPCs remain the authorization boundary.

```text
Household
  Overview        /
  Transactions    /transactions
  Money           /money
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

Operational lists when the object is the row and the action is inline: transactions. Selection opens an inspector. Wide: feed plus panel. Narrow (`<1024px`): sheet. Category changes in place through `Combobox`. Dialogs are for interruption, not for a single field.

## Feedback

Optimistic overlay, inline pending (`Spinner`, `aria-busy` on the row), inline error, Undo on the row. No success modal. Do not disable the page while one row saves.

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
```
