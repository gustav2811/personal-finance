const APPLE_PAY_RE = /,?\s*apple pay on\b[\s\S]*$/i;

export function normalizeText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(APPLE_PAY_RE, "")
    .replace(/[^\p{L}\p{N}\s&'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function merchantKey(
  merchantName: string | null | undefined,
  description: string,
): string {
  const raw = merchantName?.trim() ? merchantName : description;
  let s = normalizeText(raw);
  s = s.replace(/\s+\d{3,6}$/u, "");
  s = s.replace(/\b\d{4,}\b/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || "unknown";
}

export function amountBucket(amount: number): string {
  const abs = Math.abs(amount);
  if (abs < 50) return "0-50";
  if (abs < 200) return "50-200";
  if (abs < 1000) return "200-1000";
  if (abs < 5000) return "1000-5000";
  return "5000+";
}

export function directionOf(amount: number): "debit" | "credit" {
  return amount < 0 ? "debit" : "credit";
}

const MEMO_TOKENS = ["tfsa", "mortgage", "salary", "sal", "trip"] as const;

export function memoTokens(text: string): string[] {
  const n = normalizeText(text);
  return MEMO_TOKENS.filter((token) => new RegExp(`\\b${token}\\b`).test(n));
}

export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function featureHash(parts: readonly string[]): string {
  return fnv1a(parts.join("|"));
}
