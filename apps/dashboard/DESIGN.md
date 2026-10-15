---
name: "Household observatory"
description: "Calm, clear, data-led household energy and money."
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  accent-foreground: "oklch(0.205 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  chart-1: "#ff00bf"
  chart-2: "#9500ff"
  chart-3: "#4800ff"
  chart-4: "#00b7ff"
  chart-5: "#00fffb"
  success: "oklch(0.527 0.154 150.069)"
  success-foreground: "oklch(0.985 0 0)"
  warning: "oklch(0.681 0.162 75.834)"
  warning-foreground: "oklch(0.28 0.06 70)"
  info: "oklch(0.546 0.12 250.5)"
  info-foreground: "oklch(0.985 0 0)"
  sidebar: "oklch(0.985 0 0)"
  sidebar-foreground: "oklch(0.145 0 0)"
  sidebar-primary: "oklch(0.205 0 0)"
  sidebar-primary-foreground: "oklch(0.985 0 0)"
  sidebar-accent: "oklch(0.97 0 0)"
  sidebar-accent-foreground: "oklch(0.205 0 0)"
  sidebar-border: "oklch(0.922 0 0)"
  sidebar-ring: "oklch(0.708 0 0)"
  background-dark: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  card-dark: "oklch(0.205 0 0)"
  card-foreground-dark: "oklch(0.985 0 0)"
  popover-dark: "oklch(0.205 0 0)"
  popover-foreground-dark: "oklch(0.985 0 0)"
  primary-dark: "oklch(0.922 0 0)"
  primary-foreground-dark: "oklch(0.205 0 0)"
  secondary-dark: "oklch(0.269 0 0)"
  secondary-foreground-dark: "oklch(0.985 0 0)"
  muted-dark: "oklch(0.269 0 0)"
  muted-foreground-dark: "oklch(0.708 0 0)"
  accent-dark: "oklch(0.269 0 0)"
  accent-foreground-dark: "oklch(0.985 0 0)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
  border-dark: "oklch(1 0 0 / 10%)"
  input-dark: "oklch(1 0 0 / 15%)"
  ring-dark: "oklch(0.556 0 0)"
  success-dark: "oklch(0.765 0.15 150)"
  success-foreground-dark: "oklch(0.2 0.04 150)"
  warning-dark: "oklch(0.82 0.14 85)"
  info-dark: "oklch(0.78 0.1 240)"
  info-foreground-dark: "oklch(0.2 0.04 250)"
  sidebar-dark: "oklch(0.205 0 0)"
  sidebar-foreground-dark: "oklch(0.985 0 0)"
  sidebar-primary-dark: "oklch(0.488 0.243 264.376)"
  sidebar-accent-dark: "oklch(0.269 0 0)"
  sidebar-accent-foreground-dark: "oklch(0.985 0 0)"
  sidebar-border-dark: "oklch(1 0 0 / 10%)"
  sidebar-ring-dark: "oklch(0.556 0 0)"
typography:
  display:
    fontFamily: "Geist"
    fontSize: "1.875rem"
    lineHeight: 1.15
    fontWeight: 600.0
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "Geist"
    fontSize: "1.5rem"
    lineHeight: 1.25
    fontWeight: 600.0
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Geist"
    fontSize: "0.9375rem"
    lineHeight: 1.4
    fontWeight: 600.0
  body:
    fontFamily: "Geist"
    fontSize: "0.875rem"
    lineHeight: 1.5
  body-small:
    fontFamily: "Geist"
    fontSize: "0.8125rem"
    lineHeight: 1.45
  label:
    fontFamily: "Geist"
    fontSize: "0.75rem"
    lineHeight: 1.3
    fontWeight: 500.0
  caption:
    fontFamily: "Geist"
    fontSize: "0.75rem"
    lineHeight: 1.4
  control:
    fontFamily: "Geist"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  "2xl": "1.125rem"
  "3xl": "1.375rem"
  "4xl": "1.625rem"
spacing:
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
  "10": "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2rem"
    padding: "0 0.625rem"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2rem"
    padding: "0 0.625rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2rem"
    padding: "0 0.625rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2rem"
    padding: "0 0.625rem"
  button-destructive:
    backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2rem"
    padding: "0 0.625rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0.25rem 0.625rem"
  range-choice:
    textColor: "{colors.foreground}"
    height: "1.75rem"
    padding: "0 0.5rem"
    rounded: "{rounded.lg}"
  fact-grid:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1rem"
  chart-tooltip:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.625rem"
  sidebar-item:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.sidebar-accent-foreground}"
---

# Design System: Household

## Overview

**Creative North Star: "Household observatory"**

A calm, clear, data-led view of household energy and money. Neutral surfaces recede so quantities, relationships, and exceptions carry the attention. Bright accents identify data; ordinary controls remain restrained.

The system is flat and restrained: small controls, clear labels, quiet dividers, and enough space to distinguish tasks. The orbit, timeline, and cash-flow drawing are instruments with their own geometry, composed within the same shell and theme.

**Key Characteristics:**

- Neutral surfaces with bright data accents.
- One Geist type family with tabular quantities.
- Flat content; elevated overlays.
- Responsive compositions with explicit uncertainty.

This guide describes the current application after integration with `origin/master`
(`0c8da8c`). The frontmatter is an extracted design contract, not a second runtime
theme: `app/globals.css` implements its values. When changing the system, update
the runtime CSS, this guide's frontmatter/prose, and `.impeccable/design.json`
together so the portable previews stay current. Engineering ownership and data constraints live in [ARCHITECTURE.md](ARCHITECTURE.md).

The [pattern index](components/patterns/README.md) defines the reusable APIs;
`/dev/ui` renders fixtures. `.impeccable/design.json` supplies portable visual
previews; React components remain authoritative for behavior.

## Colors

### Primary

Primary actions use the neutral `primary` / `primary-foreground` pair. The app's
primary action colour is not its brightest chart colour. Keep the shadcn neutral
surface roles: background, foreground, card, popover, secondary, muted, accent,
border, input, and ring.

### Data accents

Electric Neon Dreams is the existing five-series palette. Shocking pink
(`chart-1`), violet ray (`chart-2`), electric blue (`chart-3`), deep sky blue
(`chart-4`), and electric cyan (`chart-5`) identify series. Palette ramps live in
the namespaced CSS scales, from 50 through 950. Never override Tailwind's generic
blue/cyan scales with these names.

Consumption charts conventionally use pink for household usage and violet for
cost. Other charts map colours through their own labelled chart configuration.
Overview mixes chart colours with the foreground to keep its instruments legible.
These mappings belong to their domains, not to a global finance-status palette.

### Neutral and status roles

Light and dark themes expose the same runtime variable names. Frontmatter keys
ending in `-dark` record overrides; keys without an override retain their light
value. The theme provider chooses system, light, or dark. Use the runtime semantic
variables in components, never a frontmatter dark key as a CSS variable.

Success, warning, info, and destructive express status. Pair status with words or
icons. Status backgrounds and small status text have different contrast needs;
the FactGrid warning readout mixes warning with foreground for stronger contrast.
Do not assume a vivid swatch is readable body text on both themes.

**The Data Accent Rule.** Colour identifies a series or a state; labels and values
must still explain it without colour.

## Typography

Geist is the interface face, loaded with `next/font`. The frontmatter mirrors the
shared `type-*` utilities, plus the observed registry control type. Display is a
quantity emphasis, page-title is the page identity, section-title names a group,
body/body-small explain the task, and label/caption identify controls and context.

Use `type-numeric` on dates and amounts for tabular figures. It is a numeric
feature, not a separate typeface. Monospace is reserved for identifiers and
technical metadata. Ordinary labels use sentence case.

Overview's container-relative amounts and orbit centre are domain-specific type,
not a second global scale. Its tiny chart labels are not templates for form copy.

**The One Face Rule.** Keep the interface and quantities in Geist; distinguish
hierarchy with role, size, weight, spacing, and numeric features.

## Layout

The shell owns navigation and theme. Its top bar is 3rem high; page padding is
1rem, increasing to 1.5rem at the medium viewport breakpoint. Pages compose a
PageHeader, optional toolbar, and content. Header actions move below the title on
narrow screens. Section headers wrap actions instead of compressing the heading.

Use the existing Tailwind quarter-rem spacing scale. Frontmatter lists the common
steps already used by page and section compositions; these are not new CSS vars.
A page commonly separates groups by 1.5rem; utility instruments use 2.5rem between
larger groups. Dense controls group more tightly than unrelated sections.

FactGrid measures its own width: regular 2/3-column layouts split at 48rem;
compact facts split at 36rem, reading inline at narrower widths. The Utilities
chart grid splits at 48rem of its named container. Overview changes composition
at 50rem of its container. Do not replace these with device-name assumptions.

Compare columns in tables. Keep wide comparison tables and the cash-flow drawing
scrollable inside their own container; avoid document-wide overflow. Desktop
navigation collapses to icons; mobile navigation uses the sidebar sheet.

## Elevation & Depth

Content uses borders and neutral surface steps. Ordinary fact groups and sections
have no shadow. A Section does not imply a Card. Elevation belongs to overlays:
popovers, dialogs, sheets, menus, and chart tooltips. Preserve registry behavior.
The custom chart tooltip surface uses the existing large soft shadow; its exact
rendered shadow is recorded in the sidecar.

**The Flat Content Rule.** Use spacing, a divider, or a surface change to separate
content. Lift a surface only when it floats above the current task.

## Shapes

Radius is derived from the existing base radius; the frontmatter records the
resolved rem scale. Observed registry buttons and inputs use the base 10px radius.
Connected toggle choices keep rounded outer corners and share inner borders.
Series bars, arcs, and ribbons retain geometry suited to their visual encoding.

Borders are quiet, one-pixel semantic dividers. Selection is a surface or stroke
change plus an explicit selected state. Icons use Lucide; decorative glyphs do
not substitute for controls or labels.

## Components

### Registry controls

The installed registry is shadcn `radix-nova`, neutral, with Lucide icons and CSS
variables. Add missing primitives only when needed. Do not fork a button or input
in a feature. Source under `components/ui` remains the primitive implementation.

Observed default buttons and inputs are 32px high with 10px horizontal padding;
small range choices are 28px high. Button variants are primary, secondary,
outline, ghost, and destructive. The destructive variant uses a tinted surface
and destructive text, not a solid red primary treatment. Preserve native disabled,
focus-visible, and keyboard states rather than translating preview CSS into a
replacement runtime component.

### Shared household compositions

| Pattern | Use |
| --- | --- |
| PageHeader | One h1, optional description, breadcrumbs, and actions. |
| Section | h2 plus optional description/actions; unboxed content by default. |
| FactGrid | Label/value/detail facts with dt/dd semantics; regular or compact layout. |
| DateField / RangeControl / HistoryControl | Controlled dates and time windows, with domain meaning supplied by the caller. |
| ChartEmpty | No-data footprint with a title and optional explanation. |
| ChartTooltipSurface | Custom domain readouts; prefer registry ChartTooltipContent for ordinary series. |
| DataGate | Stable loader, loading skeleton, blocking failure and retry; it does not own all budget mutation lifecycles. |

### Navigation, lists, and feedback

The sidebar groups Household, Home, and Record. Render only working destinations.
Active navigation uses the sidebar accent. Page filters stay with their page.
Ledger rows are at least 48px high; the table compares date, merchant, account,
category, and amount. Editing opens one focused review dialog rather than an
editor on every row. Changes use inline pending/error feedback and local actions.
A state is not automatically a badge; badges/toggles represent filters when useful.

### Household instruments

Keep OrbitChart and SpendingTimeline in `domain/overview`, financial breakdowns
and cash flow in `domain/analysis`, and consumption charts in `domain/consumption`.
Charts use Recharts through ChartContainer where applicable; cash flow is an
interactive SVG diagram. Keep their legends, labels, keyboard drill-down, and
missing-data explanations. Do not abstract them into one chart factory.

Smart Charts references guide geometry and interaction, below existing application
components and tokens in precedence. Start at
[the Smart Charts guide](../../docs/design/smart-charts/README.md), not Figma.
Reference SVGs are examples, not embedded assets.

Motion supports selection and continuity. Overview uses brief 220–260ms changes;
there is no global entrance-animation requirement. Reduced-motion overrides live
in `app/globals.css` and the Overview modules. Preserve primitive focus behavior,
accessible names, and native interactions when composing new UI.

## Do's and Don'ts

### Do

- Do compose registry primitives and shared patterns before adding a new component.
- Do keep financial values signed and units explicit.
- Do distinguish zero, unknown, stale, empty, loading, and failed states.
- Do check narrow widths, both themes, keyboard focus, and reduced motion.

### Don't

- Don't create a second palette, primitive library, or generic dashboard widget framework.
- Don't use chart colour as the only cue for status or selection.
- Don't wrap every section in a card or put page filters in the sidebar.
- Don't embed reference SVGs or hard-code their 600px canvas into the application.
