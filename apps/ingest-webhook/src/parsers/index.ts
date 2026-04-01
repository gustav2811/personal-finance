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
    fromDomains: ["bankzero.co.za", "bankzerosa.co.za"],
    toLocalParts: ["bankzero", "statements"],
    filenamePatterns: [
      /bankzero/i,
      /statement.*\.(xlsx|xls)$/i,
      /transactional.*\.(xlsx|xls)$/i,
      // Bank Zero transactional exports use "Transaction 8020…" not "Transactional…"
      /^transaction\s+.*\.(xlsx|xls)$/i,
    ],
  },
];

/** Domain of the mailbox in a From header (handles `"Name" <user@host>`). */
export function parseDomainFromFromHeader(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : from).trim();
  const at = addr.lastIndexOf("@");
  if (at === -1) return "";
  let host = addr.slice(at + 1).trim();
  host = host.replace(/[>\s)]+$/g, "");
  return host.toLowerCase();
}

export function detectBank(
  from: string,
  to: string,
  filename: string
): string | undefined {
  const toLower = to.toLowerCase();
  const fromDomain = parseDomainFromFromHeader(from);
  // Accept either full address "user@domain" or local part "user"
  const toLocal = toLower.includes("@") ? toLower.split("@")[0] : toLower;

  for (const { code, fromDomains, toLocalParts, filenamePatterns } of BANK_DETECTION) {
    if (fromDomains.some((d) => fromDomain === d || fromDomain.endsWith("." + d))) {
      return code;
    }
    if (
      toLocalParts.some(
        (p) =>
          toLocal === p ||
          toLocal.endsWith("+" + p) ||
          toLocal.startsWith(p + "+")
      )
    ) {
      return code;
    }
    if (filenamePatterns.some((re) => re.test(filename))) {
      return code;
    }
  }
  return undefined;
}

/** Returns the best spreadsheet attachment (prefer .xlsx, then .xls, then .csv). Preserves full attachment type for use with payloadToBuffer. */
export function pickBestAttachment<T extends { filename: string }>(
  attachments: T[],
): T | undefined {
  const candidates = attachments.filter(
    (a) =>
      /\.xlsx$/i.test(a.filename) ||
      /\.xls$/i.test(a.filename) ||
      /\.csv$/i.test(a.filename),
  );
  if (candidates.length === 0) return undefined;
  const score = (filename: string) =>
    /\.xlsx$/i.test(filename) ? 2 : /\.xls$/i.test(filename) ? 1 : 0;
  return candidates.sort((a, b) => score(b.filename) - score(a.filename))[0];
}

export function getParserForBank(bankCode: string): BankParser | undefined {
  return getParser(bankCode);
}
