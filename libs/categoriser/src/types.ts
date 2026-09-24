export type Direction = "debit" | "credit";

export type PredictionSource =
  | "correction"
  | "history"
  | "rule"
  | "jev"
  | "abstain";

export interface TxFeatures {
  id: string;
  date: string;
  merchantKey: string;
  descriptionNorm: string;
  notesNorm: string;
  direction: Direction;
  amountBucket: string;
  amountAbs: number;
  isTransfer: boolean;
  categoryId: string | null;
  categoryName: string | null;
  originalCategoryId: string | null;
  accountId: string;
  needsReview: boolean;
  updatedAt: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  criterion: string;
}

export interface MerchantStat {
  merchantKey: string;
  total: number;
  counts: Record<string, number>;
  majority: string | null;
  majorityCount: number;
  purity: number;
  lastDate: string;
}

export interface EvidenceIndex {
  byMerchant: Map<string, MerchantStat>;
  exemplarsByCategory: Map<string, string[]>;
}

export interface ClassificationDecision {
  categoryName: string | null;
  categorySlug: string | null;
  source: PredictionSource;
  confidence: number;
  margin: number;
  topProbability: number;
  probabilities: Record<string, number>;
  model: string | null;
  inputTokens: number;
  accept: boolean;
}

export interface AcceptancePolicy {
  historyMinSupport: number;
  historyMinPurity: number;
  jevMinConfidence: number;
  jevMinProbability: number;
  jevMinMargin: number;
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JevChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string | null;
  usage: JevUsage;
}

export type JevVariant = "names" | "descriptions" | "exemplars" | "history_hint";

export interface DecisionModel {
  classify(input: {
    state: unknown;
    questions: Record<string, unknown>;
  }): Promise<JevChoice>;
}
