import type { BankParser } from "./types.js";

const parsers = new Map<string, BankParser>();

export function registerParser(bankCode: string, parser: BankParser): void {
  parsers.set(bankCode, parser);
}

export function getParser(bankCode: string): BankParser | undefined {
  return parsers.get(bankCode);
}

export function getRegisteredBanks(): string[] {
  return Array.from(parsers.keys());
}
