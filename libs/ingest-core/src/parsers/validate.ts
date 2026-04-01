import type { CanonicalTransaction } from "./types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCanonicalTransaction(
  tx: unknown,
): tx is CanonicalTransaction {
  if (tx == null || typeof tx !== "object") return false;
  const t = tx as Record<string, unknown>;
  if (typeof t.external_id !== "string" || !t.external_id) return false;
  if (typeof t.account_id !== "string" || !t.account_id) return false;
  if (typeof t.date !== "string" || !ISO_DATE.test(t.date)) return false;
  if (typeof t.amount !== "number" || Number.isNaN(t.amount)) return false;
  if (typeof t.currency !== "string" || !t.currency) return false;
  if (typeof t.description !== "string") return false;
  if (t.meta == null || typeof t.meta !== "object") return false;
  const meta = t.meta as Record<string, unknown>;
  if (
    typeof meta.bank !== "string" ||
    typeof meta.source_email !== "string" ||
    typeof meta.filename !== "string"
  ) {
    return false;
  }
  return true;
}

export function validateAll(
  list: unknown[],
): { valid: CanonicalTransaction[]; invalid: unknown[] } {
  const valid: CanonicalTransaction[] = [];
  const invalid: unknown[] = [];
  for (const item of list) {
    if (validateCanonicalTransaction(item)) {
      valid.push(item);
    } else {
      invalid.push(item);
    }
  }
  return { valid, invalid };
}
