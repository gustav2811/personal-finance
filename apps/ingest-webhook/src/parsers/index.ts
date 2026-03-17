import { registerParser, getParser } from "./registry.js";
import { bankZeroParser } from "./bank-zero.js";
import type { BankParser } from "./types.js";

registerParser("bank_zero", bankZeroParser);

export { getParser, getRegisteredBanks } from "./registry.js";
export type { CanonicalTransaction, ParserContext, BankParser } from "./types.js";
export { bankZeroParser } from "./bank-zero.js";

const BANK_DETECTION: Array<{
  code: string;
  fromDomains: string[];
  toLocalParts: string[];
  filenamePatterns: RegExp[];
}> = [
  {
    code: "bank_zero",
    fromDomains: ["bankzero.co.za"],
    toLocalParts: ["bankzero", "statements"],
    filenamePatterns: [/bankzero/i, /statement.*\.xlsx$/i],
  },
];

export function detectBank(
  from: string,
  to: string,
  filename: string
): string | undefined {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  const fromDomain = fromLower.includes("@") ? fromLower.split("@")[1] : "";
  const toLocal = toLower.includes("@") ? toLower.split("@")[0] : "";

  for (const { code, fromDomains, toLocalParts, filenamePatterns } of BANK_DETECTION) {
    if (fromDomains.some((d) => fromDomain === d || fromDomain.endsWith("." + d))) {
      return code;
    }
    if (toLocalParts.some((p) => toLocal === p)) {
      return code;
    }
    if (filenamePatterns.some((re) => re.test(filename))) {
      return code;
    }
  }
  return undefined;
}

/** Returns the best XLSX/CSV attachment from the array (prefer .xlsx). Preserves full attachment type for use with payloadToBuffer. */
export function pickBestAttachment<T extends { filename: string }>(
  attachments: T[],
): T | undefined {
  const candidates = attachments.filter(
    (a) => /\.xlsx$/i.test(a.filename) || /\.csv$/i.test(a.filename),
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => {
    if (/\.xlsx$/i.test(a.filename) && !/\.xlsx$/i.test(b.filename)) return -1;
    if (!/\.xlsx$/i.test(a.filename) && /\.xlsx$/i.test(b.filename)) return 1;
    return 0;
  })[0];
}

export function getParserForBank(bankCode: string): BankParser | undefined {
  return getParser(bankCode);
}
