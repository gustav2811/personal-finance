import { copy } from "./copy"
import { chartShare, type PlanCapacity } from "./capacity"
import { formatCents } from "./money"

function Bar({
  cents,
  scaleCents,
  tone,
  label,
}: {
  cents: string
  scaleCents: string
  tone: "agreed" | "proposed"
  label: string
}) {
  const share = chartShare(cents, scaleCents)
  return (
    <div className="relative h-3 w-full rounded-md bg-muted outline outline-1 outline-foreground/25">
      <div
        className={tone === "agreed" ? "h-full rounded-md bg-chart-1 outline outline-1 outline-foreground/40" : "h-full rounded-md bg-chart-2 outline outline-1 outline-foreground/40"}
        style={{ width: `${share / 10}%` }}
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}

function Marker({ cents, scaleCents, label }: { cents: string; scaleCents: string; label: string }) {
  const share = chartShare(cents, scaleCents)
  return (
    <div className="relative mt-1 h-6">
      <div
        className="absolute top-0 h-3 w-px bg-foreground"
        style={{ left: `${share / 10}%` }}
      />
      <p className="type-caption text-foreground" style={{ marginLeft: `${Math.min(share / 10, 70)}%` }}>
        {label}
      </p>
    </div>
  )
}

export function PlanCapacityChart({ capacity }: { capacity: PlanCapacity }) {
  if (capacity.status === "missing") {
    return <p className="type-body">{capacity.missing}</p>
  }
  if (capacity.status === "pending") {
    return <p className="type-body">{copy.calculationPending}</p>
  }
  return (
    <div className="max-w-xl space-y-4">
      {capacity.rows.map((row) => (
        <div key={row.id}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="type-label">{row.id === "agreed" ? copy.agreedContributions : copy.proposedContributions}</p>
            <p className="type-numeric">{formatCents(row.contributionsCents)}</p>
          </div>
          <Bar
            cents={row.contributionsCents}
            label={row.readout}
            scaleCents={capacity.scaleCents}
            tone={row.id}
          />
          <Marker cents={row.incomeCents} label={row.markerLabel} scaleCents={capacity.scaleCents} />
          <p className="type-body">{row.readout}</p>
          {row.visualCapped ? (
            <p className="type-caption text-muted-foreground">The scale updates when you leave the field. The amount above is exact.</p>
          ) : null}
        </div>
      ))}
      <p className="type-caption text-muted-foreground">{copy.notCash}</p>
    </div>
  )
}
