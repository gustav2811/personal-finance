import { copy } from "./copy"
import { formatDayMonth } from "./cycle"
import { chartShare } from "./capacity"
import { formatCents, isCents, isNegativeCents } from "./money"

export function PurposeTarget({
  accessibleOn,
  dueOn,
  historical,
  restrictedCents,
  savedCents,
  targetCents,
}: {
  accessibleOn: string | null
  dueOn: string | null
  historical: boolean
  restrictedCents: string | null
  savedCents: string | null
  targetCents: string | null
}) {
  if (historical) {
    return (
      <p className="type-body-small text-muted-foreground">
        Target {formatCents(targetCents)}{dueOn ? ` · Due ${formatDayMonth(dueOn)}` : ""}. Current savings are not part of this historical agreement.
      </p>
    )
  }
  if (!targetCents || !isCents(targetCents) || isNegativeCents(targetCents) || targetCents === "0" || !dueOn) {
    return <p className="type-body-small text-muted-foreground">No dated target. {copy.projectionMissing}</p>
  }
  if (savedCents === null || !isCents(savedCents) || isNegativeCents(savedCents)) {
    return (
      <p className="type-body-small">
        Target {formatCents(targetCents)} · Due {formatDayMonth(dueOn)}. Saved now is {savedCents === null ? "not in this read" : formatCents(savedCents)}. {copy.projectionMissing}
      </p>
    )
  }
  const scale = BigInt(savedCents) > BigInt(targetCents) ? savedCents : targetCents
  const savedShare = chartShare(savedCents, scale)
  const targetShare = chartShare(targetCents, scale)
  const gap = (BigInt(targetCents) - BigInt(savedCents)).toString()
  const ahead = gap.startsWith("-")
  return (
    <div className="max-w-xl space-y-2">
      <p className="type-body-small">
        Saved now {formatCents(savedCents)}. Target {formatCents(targetCents)} · Due {formatDayMonth(dueOn)}.{" "}
        {ahead ? `${formatCents(gap.slice(1))} above the target.` : `${formatCents(gap)} still short of the target.`}
      </p>
      <div className="relative h-3 rounded-md bg-muted outline outline-1 outline-foreground/25">
        <div className="h-full rounded-md bg-chart-1 outline outline-1 outline-foreground/40" style={{ width: `${savedShare / 10}%` }} />
        <div className="absolute top-0 h-3 w-px bg-foreground" style={{ left: `${targetShare / 10}%` }} />
      </div>
      <p className="type-caption text-muted-foreground">Saved now is the pink fill. Target is the mark. {copy.projectionMissing}</p>
      {restrictedCents && isCents(restrictedCents) && restrictedCents !== "0" ? (
        <p className="type-body-small">
          Restricted backing {formatCents(restrictedCents)}.{" "}
          {accessibleOn ? `Accessible ${formatDayMonth(accessibleOn)}.` : "Its accessibility date is not in this read."} Reaching the target does not prove the bill can be paid by the due date.
        </p>
      ) : null}
    </div>
  )
}
