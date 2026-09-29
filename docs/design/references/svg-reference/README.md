# Smart Charts SVG reference

These SVGs are reference designs exported from the Smart Charts Kit Figma Community file.

Start at [`../../smart-charts/README.md`](../../smart-charts/README.md). That file is the entry point for colours, type, shadows, and precedence.

They are **visual and implementation references**, not application assets that must be rendered directly. When building charts, inspect the relevant SVG to understand geometry, spacing, strokes, fills, gradients, typography, highlighting and interaction-state treatment.

Prefer the application's existing charting library and components. Recreate the design language rather than embedding these SVGs as static charts.

## Reference index

| File | Chart type | Useful reference for |
|---|---|---|
| `Chart 1.svg` | Segmented radial / doughnut chart | Multi-category proportions, separated radial segments, central KPI/value |
| `Chart 2.svg` | Doughnut chart | Standard categorical proportions, compact centre state/icon |
| `Chart 3.svg` | Progress doughnut | Percentage/progress visualisation, partial muted segments, central percentage |
| `Chart 4.svg` | Vertical range / activity chart | Thin vertical indicators, baseline/range treatment, categorical time axis |
| `Chart 5.svg` | Grouped vertical bar chart | Multiple values per category, selected-column highlighting, purple palette |
| `Chart 6.svg` | Stacked vertical bar chart | Composition by category, stacked values, muted remainder/background |
| `Chart 7.svg` | Area / line chart | Smooth trend line, translucent area fill, selected-period highlight and data point |
| `Chart 8.svg` | Line / area chart with focus state | Time-series trend, gradient focus region, selected data point and annotation treatment |
| `Chart 9.svg` | Multi-series line chart | Comparing two time series, overlapping lines, selected point and vertical guides |
| `Chart 10.svg` | Semicircular gauge | Gauge/progress visualisation, threshold colours, central status indicator |
| `Chart 11.svg` | Dark radial gauge | Dark-theme gauge, progress arc, endpoint treatment and central metric |
| `Chart 12.svg` | Dark horizontal progress bars | Ranked/category values, multiple series colours, progress tracks and labels |
| `Chart 13.svg` | Dark vertical activity chart | Thin vertical values, selected-category treatment, dark-theme grid/track styling |
| `Chart 14.svg` | Dark vertical range chart | Vertical ranges, gradient/faded stems, time categories on dark background |
| `Chart 15.svg` | Dark line chart | Smooth time series, selected-period column, highlighted data point |

## How agents should use these

When implementing a chart:

1. Identify the closest reference chart above
2. Inspect its SVG rather than relying only on this description
3. Extract relevant visual properties such as spacing, stroke width, radius, gradients, opacity, typography and selected states
4. Implement the chart using the project's existing chart library and design primitives
5. Use [`../../smart-charts/tokens.json`](../../smart-charts/tokens.json) where the app has no equivalent token, rather than copying values by eye
6. Preserve the underlying visual language while adapting the chart to the actual data and UX requirements

## Reference hierarchy

When sources conflict, follow the precedence in [`../../smart-charts/README.md`](../../smart-charts/README.md).

The SVGs primarily answer **"how should this type of chart look?"**, not **"how should this chart be implemented?"**

## Overview

The complete chart collection is also available as [`../smart-charts-kit.png`](../smart-charts-kit.png). Use it when choosing an appropriate chart pattern or comparing light and dark treatments. Use the individual SVG once a pattern has been selected.
