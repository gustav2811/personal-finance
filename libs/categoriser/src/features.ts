import {
  amountBucket,
  directionOf,
  featureHash,
  memoTokens,
  merchantKey,
  normalizeText,
} from "./normalize.js";
import type { TxFeatures } from "./types.js";

export interface RawTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  merchantName?: string | null;
  notes?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  originalCategoryId?: string | null;
  accountId: string;
  isTransfer?: boolean | null;
  needsReview?: boolean | null;
  updatedAt?: string | null;
}

export function toFeatures(raw: RawTransaction): TxFeatures {
  const descriptionNorm = normalizeText(raw.description);
  const notesNorm = normalizeText(raw.notes ?? "");
  const key = merchantKey(raw.merchantName, raw.description);
  return {
    id: raw.id,
    date: raw.date,
    merchantKey: key,
    descriptionNorm,
    notesNorm,
    direction: directionOf(raw.amount),
    amountBucket: amountBucket(raw.amount),
    amountAbs: Math.abs(raw.amount),
    isTransfer: raw.isTransfer === true,
    categoryId: raw.categoryId ?? null,
    categoryName: raw.categoryName ?? null,
    originalCategoryId: raw.originalCategoryId ?? null,
    accountId: raw.accountId,
    needsReview: raw.needsReview === true,
    updatedAt: raw.updatedAt ?? null,
  };
}

export function txFeatureHash(tx: TxFeatures): string {
  return featureHash([
    tx.merchantKey,
    tx.descriptionNorm,
    tx.notesNorm,
    tx.direction,
    tx.amountBucket,
    tx.isTransfer ? "1" : "0",
  ]);
}

export function correctionFingerprint(tx: TxFeatures): string {
  return featureHash([tx.merchantKey, tx.direction, memoTokens(`${tx.notesNorm} ${tx.descriptionNorm}`).join(",")]);
}
