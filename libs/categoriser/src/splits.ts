import { fnv1a } from "./normalize.js";
import type { TxFeatures } from "./types.js";

export interface TemporalSplit {
  reference: TxFeatures[];
  tune: TxFeatures[];
  final: TxFeatures[];
}

export function temporalSplit(
  rows: readonly TxFeatures[],
  bounds: { tuneStart: string; finalStart: string } = {
    tuneStart: "2026-04-01",
    finalStart: "2026-07-01",
  },
): TemporalSplit {
  const reference: TxFeatures[] = [];
  const tune: TxFeatures[] = [];
  const final: TxFeatures[] = [];
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    if (day >= bounds.finalStart) final.push(row);
    else if (day >= bounds.tuneStart) tune.push(row);
    else reference.push(row);
  }
  return { reference, tune, final };
}

export const SACRED_START = "2026-09-11";
export const DEV_START = "2026-04-01";
export const DEV_END = "2026-07-01";

export function sampleStratifiedSeeded(
  rows: readonly TxFeatures[],
  perClass: number,
  cap: number,
  seed: string,
): TxFeatures[] {
  const groups = new Map<string, TxFeatures[]>();
  for (const row of rows) {
    if (!row.categoryName) continue;
    const list = groups.get(row.categoryName) ?? [];
    list.push(row);
    groups.set(row.categoryName, list);
  }
  const picked: TxFeatures[][] = [];
  for (const category of [...groups.keys()].sort()) {
    const list = groups.get(category) ?? [];
    const ranked = [...list].sort((a, b) => {
      const left = fnv1a(`${seed}|${a.id}`);
      const right = fnv1a(`${seed}|${b.id}`);
      return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    });
    picked.push(ranked.slice(0, perClass));
  }
  const out: TxFeatures[] = [];
  for (let index = 0; index < perClass && out.length < cap; index++) {
    for (const list of picked) {
      const row = list[index];
      if (row && out.length < cap) out.push(row);
    }
  }
  return out;
}

export function merchantHoldout(
  rows: readonly TxFeatures[],
  percent = 20,
): { reference: TxFeatures[]; heldOut: TxFeatures[] } {
  const reference: TxFeatures[] = [];
  const heldOut: TxFeatures[] = [];
  for (const row of rows) {
    const bucket = Number.parseInt(fnv1a(row.merchantKey).slice(0, 2), 16) % 100;
    if (bucket < percent) heldOut.push(row);
    else reference.push(row);
  }
  return { reference, heldOut };
}
