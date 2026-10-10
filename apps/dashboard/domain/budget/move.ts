import type { MoveKind } from "./commands"
import { copy } from "./copy"
import { formatCents } from "./money"

export type MoveConfirmInput = {
  kind: MoveKind
  fromName: string
  toName: string
  amountCents: string
}

export function moveConfirmCopy(input: MoveConfirmInput): readonly string[] {
  return [
    input.kind,
    input.fromName,
    input.toName,
    formatCents(input.amountCents),
    copy.planUnchanged,
  ]
}

const RANDS = /^-?\d+(?:[.,]\d{1,2})?$/

export function randsToCents(raw: string): string | null {
  const compact = raw.trim().replace(/\s/g, "").replace(/^(-?)R/i, "$1")
  if (!RANDS.test(compact)) return null
  const negative = compact.startsWith("-")
  const body = negative ? compact.slice(1) : compact
  const [whole, frac = ""] = body.split(/[.,]/)
  const digits = `${whole}${frac.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "")
  return negative ? `-${digits}` : digits
}
