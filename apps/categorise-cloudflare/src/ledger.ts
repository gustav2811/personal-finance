import { isMovement, slugOf, type TransactionNature } from "@investments/categoriser";

export const HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
export const JEV_TAG_ID = "b14d2704-3865-48d0-a5fd-92b936de6933";

export function isClassificationCandidate(txn: { archivedAt?: string | null }): boolean {
  return !txn.archivedAt;
}

export function categorySlug(name: string, sourceId: string): string {
  const slug = slugOf(name);
  if (slug) return slug;
  return `source_${sourceId.replace(/-/g, "")}`;
}

export function occurredOn(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortValue(record[key]);
    return sorted;
  }
  return value;
}

export async function payloadHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownedCategoryIdForName(
  ownedByName: ReadonlyMap<string, string>,
  predictedName: string | null,
): string | null {
  if (!predictedName) return null;
  return ownedByName.get(predictedName) ?? null;
}

export function tagIdsOf(tx: {
  tagIds?: unknown;
  transactionTags?: unknown;
  tags?: unknown;
}): string[] {
  const direct = stringIds(tx.tagIds);
  if (direct.length > 0) return direct;
  const tagged = idsFrom(tx.transactionTags);
  if (tagged.length > 0) return tagged;
  return idsFrom(tx.tags);
}

export function mergeJevTag(existingTagIds: readonly string[], jevTagId = JEV_TAG_ID): string[] {
  if (existingTagIds.includes(jevTagId)) return [...existingTagIds];
  return [...existingTagIds, jevTagId];
}

export function projectionBody(categoryId: string, existingTagIds: readonly string[]): {
  transactionCategoryId: string;
  needsReview: false;
  tagIds: string[];
} {
  return {
    transactionCategoryId: categoryId,
    needsReview: false,
    tagIds: mergeJevTag(existingTagIds),
  };
}

export function proposedTreatment(nature: TransactionNature, sourceIsTransfer: boolean | null): {
  isTransfer: boolean;
  excludeFromSpend: boolean;
  nature: TransactionNature;
} {
  const movement = isMovement(nature);
  return {
    isTransfer: movement || sourceIsTransfer === true,
    excludeFromSpend: movement,
    nature,
  };
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function idsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string") ids.push(item);
    else if (item && typeof item === "object" && "id" in item && typeof item.id === "string") ids.push(item.id);
  }
  return ids;
}
