import { createHash } from "crypto";

export function buildExternalId(
  bankCode: string,
  accountRef: string,
  date: string,
  amount: number,
  reference: string,
): string {
  const payload = [bankCode, accountRef, date, String(amount), reference]
    .filter(Boolean)
    .join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
