import { normalizeText } from "./normalize.js";
import type { TxFeatures } from "./types.js";

export type TransactionNature =
  | "purchase"
  | "income"
  | "internal_transfer"
  | "investment_contribution"
  | "loan_payment"
  | "savings_transfer"
  | "refund"
  | "fee"
  | "other";

export interface AccountLookup {
  id: string;
  name: string;
  type: string | null;
}

export interface ResolvedRelation {
  accountName: string;
  accountType: string | null;
  counterpartyKey: string;
  ownAccount: { id: string; name: string } | null;
  pair: {
    otherId: string;
    otherAccountId: string;
    otherAccountName: string;
    dayGap: number;
    amountMatch: "exact" | "near";
  } | null;
  nature: TransactionNature;
  pairKey: string;
}

const MOVEMENT: ReadonlySet<TransactionNature> = new Set([
  "internal_transfer",
  "investment_contribution",
  "loan_payment",
  "savings_transfer",
]);

export function isMovement(nature: TransactionNature): boolean {
  return MOVEMENT.has(nature);
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(iso.slice(0, 10)) / 86_400_000);
}

function accountLabel(account: AccountLookup): string {
  return account.name.trim() || account.id;
}

export function resolveRelations(
  rows: readonly TxFeatures[],
  accounts: readonly AccountLookup[],
): Map<string, ResolvedRelation> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const names = accounts
    .map((account) => ({ account, norm: normalizeText(accountLabel(account)) }))
    .filter((item) => item.norm.length >= 4)
    .sort((a, b) => b.norm.length - a.norm.length);

  const pairs = assignPairs(rows);
  const out = new Map<string, ResolvedRelation>();
  for (const row of rows) {
    const account = byId.get(row.accountId);
    const accountName = account ? accountLabel(account) : row.accountName;
    const own = matchOwnAccount(row, names);
    const pair = pairs.get(row.id) ?? null;
    const other = pair ? rows.find((item) => item.id === pair.otherId) : undefined;
    const otherAccount = other ? byId.get(other.accountId) : undefined;
    const otherName = otherAccount
      ? accountLabel(otherAccount)
      : other?.accountName ?? pair?.otherAccountId ?? "";
    const resolvedPair = pair
      ? {
          otherId: pair.otherId,
          otherAccountId: pair.otherAccountId,
          otherAccountName: otherName,
          dayGap: pair.dayGap,
          amountMatch: pair.amountMatch,
        }
      : null;
    const destName = resolvedPair?.otherAccountName || own?.name || "";
    const destType = otherAccount?.type ?? (own ? byId.get(own.id)?.type ?? null : null);
    const trusted = isTrustedLink(row, destName, destType, Boolean(own), other?.isTransfer === true);
    const nature = natureOf(row, destName, destType, trusted);
    const counterpartyKey = row.merchantKey || "unknown";
    const pairKey = resolvedPair
      ? `${accountName} -> ${resolvedPair.otherAccountName}`
      : own
        ? `${accountName} -> ${own.name}`
        : `${accountName} -> ${counterpartyKey}`;
    out.set(row.id, {
      accountName,
      accountType: account?.type ?? null,
      counterpartyKey,
      ownAccount: own,
      pair: resolvedPair,
      nature,
      pairKey,
    });
  }
  return out;
}

function matchOwnAccount(
  row: TxFeatures,
  names: readonly { account: AccountLookup; norm: string }[],
): { id: string; name: string } | null {
  const text = `${row.merchantKey} ${row.descriptionNorm} ${row.notesNorm}`;
  for (const item of names) {
    if (item.account.id === row.accountId) continue;
    if (text.includes(item.norm)) return { id: item.account.id, name: item.account.name };
  }
  return null;
}

interface AssignedPair {
  otherId: string;
  otherAccountId: string;
  dayGap: number;
  amountMatch: "exact" | "near";
}

function assignPairs(rows: readonly TxFeatures[]): Map<string, AssignedPair> {
  const candidates: {
    left: TxFeatures;
    right: TxFeatures;
    dayGap: number;
    amountMatch: "exact" | "near";
    score: number;
  }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const left = rows[i];
    if (!left) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const right = rows[j];
      if (!right) continue;
      if (left.accountId === right.accountId) continue;
      if (left.direction === right.direction) continue;
      const dayGap = Math.abs(dayNumber(left.date) - dayNumber(right.date));
      if (!Number.isFinite(dayGap) || dayGap > 3) continue;
      const delta = Math.abs(left.amountAbs - right.amountAbs);
      const exact = delta < 0.01;
      const near = delta <= Math.max(1, left.amountAbs * 0.02);
      if (!exact && !near) continue;
      candidates.push({
        left,
        right,
        dayGap,
        amountMatch: exact ? "exact" : "near",
        score: (exact ? 0 : 100) + dayGap * 10 + delta,
      });
    }
  }
  candidates.sort(
    (a, b) => a.score - b.score || a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id),
  );
  const used = new Set<string>();
  const assigned = new Map<string, AssignedPair>();
  for (const candidate of candidates) {
    if (used.has(candidate.left.id) || used.has(candidate.right.id)) continue;
    used.add(candidate.left.id);
    used.add(candidate.right.id);
    assigned.set(candidate.left.id, {
      otherId: candidate.right.id,
      otherAccountId: candidate.right.accountId,
      dayGap: candidate.dayGap,
      amountMatch: candidate.amountMatch,
    });
    assigned.set(candidate.right.id, {
      otherId: candidate.left.id,
      otherAccountId: candidate.left.accountId,
      dayGap: candidate.dayGap,
      amountMatch: candidate.amountMatch,
    });
  }
  return assigned;
}

function isTrustedLink(
  row: TxFeatures,
  destName: string,
  destType: string | null,
  namedOwnAccount: boolean,
  otherIsTransfer: boolean,
): boolean {
  const text = normalizeText(`${row.notesNorm} ${row.descriptionNorm} ${row.merchantKey} ${destName}`);
  return (
    namedOwnAccount ||
    row.isTransfer ||
    otherIsTransfer ||
    destType === "loan" ||
    destType === "investment" ||
    /\b(tfsa|mortgage|bond)\b/.test(text) ||
    text.includes("home loan") ||
    normalizeText(destName).includes("saving")
  );
}

function natureOf(
  row: TxFeatures,
  destName: string,
  destType: string | null,
  linked: boolean,
): TransactionNature {
  const text = normalizeText(`${row.notesNorm} ${row.descriptionNorm} ${row.merchantKey} ${destName}`);
  if (linked) {
    if (destType === "investment" || /\b(tfsa|easyequities|investment)\b/.test(text)) {
      return "investment_contribution";
    }
    if (destType === "loan" || /\b(mortgage|bond)\b/.test(text) || text.includes("home loan")) {
      return "loan_payment";
    }
    if (normalizeText(destName).includes("saving")) return "savings_transfer";
    return "internal_transfer";
  }
  if (row.direction === "credit" && /\b(salary|salaries|wages)\b/.test(text)) return "income";
  if (/\brefund\b/.test(text)) return "refund";
  if (row.direction === "debit" && /\b(fee|charges)\b/.test(text) && row.amountAbs < 500) return "fee";
  if (row.direction === "debit") return "purchase";
  return "other";
}
