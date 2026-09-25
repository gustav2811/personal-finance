export interface RecordedWrite {
  transactionId: string;
  categoryId: string;
  writtenAt: string;
}

export type ObservationKind =
  | "unlabelled"
  | "our_write"
  | "human_correction"
  | "unchanged"
  | "external_label";

export function observeCategoryChange(input: {
  transactionId: string;
  currentCategoryId: string | null;
  lastAppliedCategoryId: string | null;
  writes: readonly RecordedWrite[];
}): ObservationKind {
  if (!input.currentCategoryId) return "unlabelled";
  const ours = input.writes.filter((write) => write.transactionId === input.transactionId);
  const wroteCurrent = ours.some((write) => write.categoryId === input.currentCategoryId);
  if (wroteCurrent) return "our_write";
  if (
    input.lastAppliedCategoryId &&
    input.currentCategoryId !== input.lastAppliedCategoryId
  ) {
    return "human_correction";
  }
  if (input.lastAppliedCategoryId && input.currentCategoryId === input.lastAppliedCategoryId) {
    return "unchanged";
  }
  return "external_label";
}

export function mayAutoApply(input: {
  mode: string;
  accept: boolean;
  kind: ObservationKind;
  movementLike: boolean;
  predictedCategoryId: string | null;
  currentCategoryId: string | null;
}): boolean {
  if (input.mode !== "auto") return false;
  if (!input.accept) return false;
  if (input.kind === "human_correction" || input.kind === "our_write") return false;
  if (input.movementLike) return false;
  if (!input.predictedCategoryId) return false;
  return input.predictedCategoryId !== input.currentCategoryId;
}

export function shouldSkipRewrite(input: {
  kind: ObservationKind;
  predictedCategoryId: string | null;
  currentCategoryId: string | null;
}): boolean {
  if (input.kind === "human_correction" || input.kind === "our_write") return true;
  if (
    input.predictedCategoryId &&
    input.currentCategoryId &&
    input.predictedCategoryId === input.currentCategoryId
  ) {
    return true;
  }
  return false;
}
