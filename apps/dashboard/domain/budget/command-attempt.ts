export type HeldCommand = {
  id: string
  name: string
  fingerprint: string
  payload: Record<string, unknown>
}

const DEFINITE_REJECTION = [
  "budget_invalid",
  "budget_forbidden",
  "budget_stale",
  "budget_not_found",
  "budget_incomplete",
  "budget_conflict",
] as const

export function holdCommand(
  held: HeldCommand | null,
  input: { name: string; fingerprint: string; payload: Record<string, unknown> },
  mint: () => string,
): HeldCommand {
  if (held && held.name === input.name && held.fingerprint === input.fingerprint) return held
  return { id: mint(), name: input.name, fingerprint: input.fingerprint, payload: input.payload }
}

export function commandFailureIsUncertain(message: string): boolean {
  return !DEFINITE_REJECTION.some((code) => message.includes(code))
}

export function commandFailureText(caught: unknown): string {
  if (caught && typeof caught === "object" && "raw" in caught && typeof caught.raw === "string") return caught.raw
  if (caught instanceof Error) return caught.message
  return ""
}
