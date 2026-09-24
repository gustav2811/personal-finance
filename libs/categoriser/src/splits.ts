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
