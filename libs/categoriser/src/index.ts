export { CATEGORY_CRITERIA, criterionFor } from "./criteria.js";
export { classifyTransaction, type ClassifyMode } from "./classify.js";
export { mayAutoApply, observeCategoryChange, shouldSkipRewrite, type ObservationKind, type RecordedWrite } from "./corrections.js";
export { ExperimentBudget, EXPERIMENT_BUDGET_USD, EXPERIMENT_STOP_USD, JEV_USD_PER_INPUT_TOKEN, notionalUsd } from "./cost.js";
export { buildEvidence, suspiciousMerchants } from "./evidence.js";
export { correctionFingerprint, toFeatures, txFeatureHash, type RawTransaction } from "./features.js";
export { buildCategoryOptions, buildJevRequest, CATEGORY_QUESTION, slugOf } from "./jev/build.js";
export { createBindingJevModel, createCloudflareJevModel, type AiBinding, type CloudflareJevConfig } from "./jev/cloudflare.js";
export { parseJevChoice, unwrapJevPayload } from "./jev/parse.js";
export { accuracy, bestThreshold, classScores, confusionPairs, coverageCurve, macroF1, selective, weightedF1, type ScoredRow, type ThresholdPoint } from "./metrics.js";
export { amountBucket, categorySlug, directionOf, featureHash, fnv1a, memoTokens, merchantKey, normalizeText } from "./normalize.js";
export { CONSERVATIVE_POLICY, historyAccepts, jevAccepts, probabilityMargin } from "./policy.js";
export { DEFAULT_CATEGORY_RULES, matchFirstRule, signedAmount, type CategoryRule } from "./rules.js";
export { merchantHoldout, temporalSplit } from "./splits.js";
export type {
  AcceptancePolicy,
  CategoryOption,
  ClassificationDecision,
  DecisionModel,
  Direction,
  EvidenceIndex,
  JevChoice,
  JevUsage,
  JevVariant,
  MerchantStat,
  PredictionSource,
  TxFeatures,
} from "./types.js";
