# Smart Charts design reference

This folder contains a reconstructed design reference derived from the
Smart Charts Kit Figma Community file.

It is intended to guide chart implementation, not to provide production
assets or dictate a specific charting library.

## Sources

- Visual overview:
  `../references/smart-charts-kit.png`
- Individual SVG references:
  `../references/svg-reference/`
- Machine-readable design tokens:
  `tokens.json`

## How to use this reference

When implementing or modifying a chart:

1. Identify the closest visual pattern in the SVG reference README
2. Inspect the corresponding SVG for geometry and visual treatment
3. Use `tokens.json` for colours, gradients, shadows, typography and radius
4. Implement using the application's existing charting library and components
5. Prefer project-level design tokens and components over these reference values
6. Use these references to preserve visual language rather than copying static SVGs

## Precedence

When sources conflict:

1. Existing application components
2. Project design-system rules and tokens
3. Smart Charts tokens
4. Individual SVG references
5. Overview PNG

## Colour palette

| Token | Value |
| --- | --- |
| `color1` | `#6BCCFE` |
| `color2` | `#FF7133` |
| `color3` | `#FFC54A` |
| `color4` | `#A08CFB` |
| `color5` | `#7CF888` |
| `color6` | `#FF75D8` |
| `color7` | `#FC5356` |
| `lightBackground` | `#FFFFFF` |
| `darkBackground` | `#171724` |
| `textColor` | `#454459` |

Do not use these colours automatically. Map them to existing application
tokens where equivalent tokens already exist.

## Gradients

The reference system uses vertical linear gradients.

Opaque gradients:

- `gradient1`: blue
- `gradient2`: orange
- `gradient3`: yellow
- `gradient4`: purple
- `gradient5`: green
- `gradient6`: pink
- `gradient7`: red

Faded gradients:

- `gradient8`: purple fade
- `gradient9`: red fade
- `gradient10`: orange fade
- `gradient11`: centred red highlight
- `gradient12`: centred white highlight
- `gradient13`: purple highlight

Use exact stops from `tokens.json`.

## Typography

Original Figma typography uses SF Pro Display.

Reference roles:

| Role | Size | Weight |
| --- | ---: | --- |
| value | 48 | Semibold |
| value large | 58 | Bold |
| percent | 52 | Medium |
| caption | 18 | Light |
| label | 20 | Light |
| axis | 12 | Medium |
| axis emphasis | 12 | Semibold |

Do not assume SF Pro Display is available in the application.

Use the application's existing typeface and reproduce the hierarchy using
equivalent weights and relative sizing.

## Cards

Reference chart cards are:

- 600 × 600 in the original design
- 16px corner radius
- Chart 2 uses an 18px radius
- Light background: `#FFFFFF`
- Dark background: `#171724`

Treat 600 × 600 as the original design canvas, not a required production size.

Charts should scale responsively to the application layout.

## Shadows

`shadow1`

```css
box-shadow: 0 5px 25px rgb(0 0 0 / 10%);
```

`shadow2`

```css
box-shadow: 0 -5px 20px rgb(0 0 0 / 12%);
```

Use these only where the corresponding visual pattern requires elevation or
highlighting.

## Interaction language

Several charts use a consistent selected-state treatment:

- highlighted time/category column
- stronger colour on the selected series or bar
- emphasised axis label
- explicit point marker
- translucent vertical highlight
- gradient focus area

When building interactive charts, preserve this visual grammar where appropriate.

## Light and dark variants

Charts 1–10 are represented as light-theme examples.

Charts 11–15 are represented as dark-theme examples.

Dark charts use:

- `darkBackground`
- white text
- bright saturated series colours
- lower-contrast tracks and guide lines

## Implementation guidance

These designs are reference patterns rather than components.

Prefer:

- native chart primitives from the project's chosen charting library
- reusable application-level chart components
- CSS/theme tokens
- responsive dimensions
- semantic data-driven rendering

Avoid:

- embedding the reference SVGs directly as charts
- hard-coding 600px dimensions
- introducing a second design-token system
- copying Figma-specific structure into application architecture
- assuming Figma typography is available in production
