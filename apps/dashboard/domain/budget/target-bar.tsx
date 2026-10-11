import { copy } from "./copy"
import { isCents } from "./money"

function fillShare(fundedCents: string, targetCents: string): number | null {
  if (!isCents(fundedCents) || !isCents(targetCents)) return null
  const target = BigInt(targetCents)
  const funded = BigInt(fundedCents)
  if (target <= BigInt(0) || funded < BigInt(0)) return null
  if (funded === BigInt(0)) return 0
  if (funded >= target) return 1000
  return Number((funded * BigInt(1000)) / target)
}

export function TargetBar({
  fundedCents,
  targetCents,
  funded,
  fundedLabel,
  target,
  suggestion,
}: {
  fundedCents: string | null
  targetCents: string | null
  funded: string
  fundedLabel: string
  target: string
  suggestion: boolean
}) {
  const share = fundedCents !== null && targetCents !== null ? fillShare(fundedCents, targetCents) : null
  if (share === null) return null
  return (
    <div className="space-y-3">
      <table className="w-full">
        {suggestion ? (
          <caption className="type-caption pb-2 text-left text-muted-foreground">{copy.suggestedNotAssigned}</caption>
        ) : null}
        <tbody>
          <tr>
            <th className="type-label py-1 text-left font-medium text-muted-foreground" scope="row">
              {fundedLabel}
            </th>
            <td className="type-numeric py-1 text-right">{funded}</td>
          </tr>
          <tr>
            <th className="type-label py-1 text-left font-medium text-muted-foreground" scope="row">
              {suggestion ? "" : copy.nextNeed}
            </th>
            <td className="type-numeric py-1 text-right">{target}</td>
          </tr>
        </tbody>
      </table>
      <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-chart-1" style={{ flexBasis: 0, flexGrow: share, minWidth: 0 }} />
        <div className="h-full" style={{ flexBasis: 0, flexGrow: 1000 - share, minWidth: 0 }} />
      </div>
    </div>
  )
}
