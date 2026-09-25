export type LegRole =
  | "economic_recognition"
  | "mirror"
  | "staging"
  | "reserve_funding"
  | "internal_conversion"
  | "settlement";

export interface AdjudicatedLeg {
  id: string;
  status: "gold" | "hold";
  categoryName: string | null;
  isTransfer: boolean | null;
  eventId: string | null;
  legRole: LegRole | null;
  note: string;
}

export interface LedgerRow {
  id: string;
  categoryName: string | null;
  isTransfer: boolean;
}

export interface StrictRow {
  id: string;
  actual: string;
  isTransfer: boolean;
  source: "ledger" | "gold";
}

export function applyAdjudication(
  rows: readonly LedgerRow[],
  overlay: readonly AdjudicatedLeg[],
): { strict: StrictRow[]; held: string[]; unknownOverlay: string[] } {
  const byId = new Map(overlay.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const strict: StrictRow[] = [];
  const held: string[] = [];
  for (const row of rows) {
    const item = byId.get(row.id);
    if (!item) {
      if (row.categoryName) {
        strict.push({
          id: row.id,
          actual: row.categoryName,
          isTransfer: row.isTransfer,
          source: "ledger",
        });
      }
      continue;
    }
    seen.add(row.id);
    if (item.status === "hold") {
      held.push(row.id);
      continue;
    }
    if (!item.categoryName) throw new Error(`gold row ${row.id} has no category`);
    strict.push({
      id: row.id,
      actual: item.categoryName,
      isTransfer: item.isTransfer ?? row.isTransfer,
      source: "gold",
    });
  }
  return {
    strict,
    held,
    unknownOverlay: overlay.filter((item) => !seen.has(item.id)).map((item) => item.id),
  };
}
