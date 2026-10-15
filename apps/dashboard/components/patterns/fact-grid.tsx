import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type Fact = {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: "default" | "warning"
}

/** Labelled facts, not controls. Callers own units, formatting, and uncertainty. */
export function FactGrid({
  items,
  columns = 3,
  compact = false,
}: {
  items: readonly Fact[]
  columns?: 2 | 3
  /** Small facts read inline on narrow surfaces, then stack when space permits. */
  compact?: boolean
}) {
  return (
    <div className="@container/facts min-w-0">
      <dl className={cn(
        "grid gap-px overflow-hidden rounded-lg border bg-border",
        columns === 2 ? "@3xl/facts:grid-cols-2" : compact ? "@xl/facts:grid-cols-3" : "@3xl/facts:grid-cols-3",
      )}>
        {items.map(({ label, value, detail, tone = "default" }) => (
          <div key={label} className={cn("min-w-0 bg-card px-4 py-3", compact ? "flex items-baseline justify-between gap-4 @xl/facts:block" : "space-y-1")}>
            <dt className="type-label text-muted-foreground">{label}</dt>
            <dd className={cn("min-w-0", compact ? "flex flex-col items-end text-right @xl/facts:mt-1 @xl/facts:items-start @xl/facts:text-left" : "space-y-1")}>
              <span className={cn("type-numeric block break-words font-semibold tracking-tight", compact ? "text-lg @xl/facts:text-xl" : "text-2xl")}
                style={tone === "warning" ? { color: "color-mix(in oklab, var(--warning) 80%, var(--foreground))" } : undefined}
              >
                {value}
              </span>
              {detail ? <span className="type-caption block">{detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
