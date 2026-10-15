# Household UI patterns

Follow [DESIGN.md](../../DESIGN.md) for the visual contract and
[ARCHITECTURE.md](../../ARCHITECTURE.md) for layer ownership. Use the existing
shadcn primitives for controls. This layer owns small, repeated
compositions; features own data, formatting, filters, and financial meaning.
The live fixture reference is `/dev/ui` (`DASHBOARD_DEMO_MODE=true yarn dev`).
It is unavailable in production and makes no live data requests.

## Choose the smallest existing piece

| Need | Use | Contract |
| --- | --- | --- |
| Page identity and actions | `PageHeader` | One h1; title, description, breadcrumbs, actions. |
| A named content group | `Section` | h2, optional description/actions; no automatic card. |
| Labelled numeric facts | `FactGrid` | `items: { label, value, detail?, tone? }[]`; unique labels. `columns` is 2 or 3. `compact` reads inline on narrow surfaces. Proper dt/dd pairs. |
| No readings for a chart | `ChartEmpty` | Title and optional explanation; consistent minimum footprint. Not a loading or error state. |
| Standard series tooltip | `ui/ChartTooltipContent` | First choice; already owns series labels and indicators. |
| Domain-specific tooltip | `ChartTooltipSurface` | Composition-only surface; children and native div props. Caller owns payload guard and formatting. |
| Feature load + retry | `DataGate` | Stable module loader or useCallback; render function receives successful data, including null. Initial load and blocking retry only. |
| Read lifecycle | `hooks/use-resource` + `ResourceFeedback` | Explicit key + stable loader. Latest request wins; identity changes hide previous data immediately. Same-resource retention is opt-in; features block dependent actions until ready. Retry repeats the read only. |
| A date or common time window | `DateField`, `RangeControl`, `HistoryControl` | Controlled values; labels and primitive keyboard behavior stay built in. |

```tsx
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { FactGrid } from "@/components/patterns/fact-grid"

// Values here are illustrative. Format real amounts/units in the feature.
<PageHeader title="Utilities" actions={rangeControl} />
<Section title="This period">
  <FactGrid compact items={[
    { label: "Usage", value: "235.4 kWh", detail: "Closed days only" },
    { label: "Cost", value: "R780", detail: "Incurred charges" },
    { label: "Budget", value: "Unknown", detail: "Reconciliation required", tone: "warning" },
  ]} />
</Section>
```

FactGrid responds to its own available width: regular facts split at 48rem;
compact facts split at 36rem. It does not know a utility, fund, or currency.
Keep interactive category rows, orbit geometry, fund scales, and ledger review
inside their domains/features. Similar shapes do not imply the same meaning.

## Foundation and growth rules

- `app/globals.css` is the runtime token source. Geist, semantic theme roles,
  `type-*` utilities, radius, and status colours are already sufficient for
  this extraction. No new palette, token file, or component package is needed.
- Charts use `chart-*`; status uses `success`, `warning`, `info`, `destructive`.
  A chart colour is not a verdict about a household's finances.
- Preserve distinctions between zero, unknown, stale, loading, empty, and failed.
  Formatting and that decision remain in the domain/feature.
- Use direct file imports. Add a pattern after at least three same-intent uses,
  migrate its callers, and add an example here and in `/dev/ui`.
- Check long labels/amounts, narrow width, both themes, empty/error/loading,
  focus, and reduced motion. A screenshot alone does not prove data correctness.

See [the extraction review](../../../../docs/design/household-ui-system.md) for
remaining duplication and the ordered follow-up work.

Verify the accessible fact contract with:

```bash
yarn tsx --test components/patterns/fact-grid.spec.tsx
```
