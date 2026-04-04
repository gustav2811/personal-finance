/**
 * Normalise bank text for rule matching and LLM input (deterministic, no network).
 */

const APPLE_PAY_RE = /,?\s*apple pay on\b[\s\S]*$/i;
const MULTISPACE = /\s+/g;

export function normalizeForMatch(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(APPLE_PAY_RE, "");
  s = s.replace(MULTISPACE, " ").trim();
  return s;
}

/** Strip trailing numeric store / branch suffixes like "11169" or " - 123". */
export function stripTrailingStoreNumbers(s: string): string {
  return s.replace(/\s+\d{3,6}\s*$/u, "").trim();
}

/** Collapse Yoco-style merchant prefixes for stable tokens. */
export function normalizeYocoMerchant(s: string): string {
  const t = normalizeForMatch(s);
  if (!t.startsWith("yoco")) return t;
  return t
    .replace(/^\s*yoco\s*\*\s*/i, "yoco ")
    .replace(/\s+/g, "_");
}

export function combinedNormalizedText(
  counterparty: string | undefined,
  description: string | undefined,
): string {
  const p = normalizeForMatch(counterparty ?? "");
  const d = normalizeForMatch(description ?? "");
  return [p, d].filter(Boolean).join(" ");
}

export function extractMemoTokens(combined: string): string[] {
  const tokens = new Set<string>();
  for (const m of combined.matchAll(/\b(tfsa|mortgage|sal|salary|trip|kruger|cpt)\b/gi)) {
    tokens.add(m[0].toLowerCase());
  }
  return [...tokens];
}
