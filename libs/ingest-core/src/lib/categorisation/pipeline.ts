import type { FinWiseClient } from "@investments/finwise";
import type { IngestCoreConfig } from "../../config.js";
import type { CanonicalTransaction } from "../../parsers/types.js";
import {
  categoriesToNameIdMap,
  fetchAllTransactionCategories,
} from "./fetch-categories.js";
import {
  canonicalToCategorisationRow,
  createGeminiBatchCategoriser,
} from "./gemini-batch.js";
import type { BatchTransactionCategoriser } from "./ports.js";
import { DEFAULT_CATEGORY_RULES, matchFirstRule } from "./rules.js";

export interface CategorisationLogger {
  info: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
}

/**
 * FinWise category list + rules + optional batched Gemini.
 * Returns new transaction objects with classification fields set.
 * Historical FinWise match is deferred (see history.ts).
 */
export async function categoriseTransactions(
  config: IngestCoreConfig,
  finwise: FinWiseClient,
  transactions: CanonicalTransaction[],
  log: CategorisationLogger,
): Promise<CanonicalTransaction[]> {
  if (!config.categorisationEnabled || transactions.length === 0) {
    return transactions.map((tx) => ({ ...tx }));
  }

  const categories = await fetchAllTransactionCategories(finwise);
  const nameToId = categoriesToNameIdMap(categories);
  const allowedCategoryNames = [...nameToId.keys()].sort();

  log.info(
    {
      categorisation_category_count: categories.length,
      categorisation_transaction_count: transactions.length,
    },
    "categorisation_categories_loaded",
  );

  const categoriser: BatchTransactionCategoriser | null =
    config.geminiApiKey.trim().length > 0
      ? createGeminiBatchCategoriser({
          apiKey: config.geminiApiKey.trim(),
          model: config.geminiModel,
          apiBase: config.geminiApiBase,
          timeoutMs: config.categorisationLlmTimeoutMs,
        })
      : null;

  const base: CanonicalTransaction[] = transactions.map((tx) => {
    const match = matchFirstRule(tx, DEFAULT_CATEGORY_RULES);
    if (match) {
      const cid = nameToId.get(match.categoryName);
      if (cid) {
        return {
          ...tx,
          transaction_category_id: cid,
          classification_source: "rule",
          classification_confidence: 1,
        };
      }
      log.warn(
        {
          external_id: tx.external_id,
          rule_id: match.ruleId,
          category_name: match.categoryName,
        },
        "categorisation_rule_unknown_finwise_category",
      );
    }
    return {
      ...tx,
      classification_source: "none",
    };
  });

  const needLlm = base.filter((t) => !t.transaction_category_id);
  let ruleHits = base.length - needLlm.length;
  let llmHits = 0;
  let llmErrors = 0;
  let noneCount = 0;

  if (needLlm.length === 0) {
    log.info(
      {
        categorisation_rule_hits: ruleHits,
        categorisation_llm_skipped: true,
      },
      "categorisation_complete",
    );
    return base;
  }

  if (!categoriser) {
    log.warn(
      { categorisation_needs_llm: needLlm.length },
      "categorisation_llm_skipped_no_gemini_key",
    );
    return base;
  }

  try {
    const rows = needLlm.map((tx) => canonicalToCategorisationRow(tx));
    const llmMap = await categoriser.classifyBatch({
      rows,
      allowedCategoryNames,
    });

    for (let i = 0; i < base.length; i++) {
      const tx = base[i];
      if (tx.transaction_category_id) continue;

      const r = llmMap.get(tx.external_id);
      if (!r) {
        base[i] = {
          ...tx,
          classification_source: "llm_error",
          classification_confidence: undefined,
        };
        llmErrors++;
        log.warn(
          { external_id: tx.external_id },
          "categorisation_llm_missing_row",
        );
        continue;
      }

      const cid = nameToId.get(r.categoryName);
      if (!cid) {
        base[i] = {
          ...tx,
          classification_source: "llm_error",
          classification_confidence: r.confidence,
        };
        llmErrors++;
        log.warn(
          {
            external_id: tx.external_id,
            category_name: r.categoryName,
          },
          "categorisation_llm_unknown_category_name",
        );
        continue;
      }

      if (r.confidence < config.categorisationMinConfidence) {
        base[i] = {
          ...tx,
          classification_source: "llm",
          classification_confidence: r.confidence,
        };
        noneCount++;
        continue;
      }

      base[i] = {
        ...tx,
        transaction_category_id: cid,
        classification_source: "llm",
        classification_confidence: r.confidence,
      };
      llmHits++;
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "categorisation_llm_batch_failed",
    );
    for (let i = 0; i < base.length; i++) {
      const tx = base[i];
      if (tx.transaction_category_id) continue;
      base[i] = {
        ...tx,
        classification_source: "llm_error",
        classification_confidence: undefined,
      };
      llmErrors++;
    }
  }

  log.info(
    {
      categorisation_rule_hits: ruleHits,
      categorisation_llm_assigned: llmHits,
      categorisation_llm_errors: llmErrors,
      categorisation_low_confidence: noneCount,
    },
    "categorisation_complete",
  );

  return base;
}
