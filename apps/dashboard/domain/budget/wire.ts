export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readComplete(value: unknown): boolean {
  return isRecord(value) && value.complete === true
}

export type WireReason = {
  code: string
}

export function readReasons(value: unknown): WireReason[] {
  return readArray(value).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.code !== "string" || entry.code.length === 0) return []
    return [{ code: entry.code }]
  })
}
