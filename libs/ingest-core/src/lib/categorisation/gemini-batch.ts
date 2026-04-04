import type { CanonicalTransaction } from "../../parsers/types.js";
import { GEMINI_SYSTEM_PROMPT, buildGeminiUserPrompt } from "./prompts.js";
import type {
  BatchTransactionCategoriser,
  CategorisationRowInput,
  LlmClassification,
} from "./ports.js";

export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const GEMINI_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      categoryName: { type: "STRING" },
      confidence: { type: "NUMBER" },
      rationale: { type: "STRING" },
    },
    required: ["id", "categoryName", "confidence"],
  },
} as const;

export interface GeminiBatchCategoriserOptions {
  apiKey: string;
  model: string;
  /** e.g. https://generativelanguage.googleapis.com */
  apiBase: string;
  timeoutMs: number;
  fetchFn?: FetchFn;
}

export function createGeminiBatchCategoriser(
  opts: GeminiBatchCategoriserOptions,
): BatchTransactionCategoriser {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const base = opts.apiBase.replace(/\/$/, "");

  return {
    async classifyBatch({ rows, allowedCategoryNames }) {
      const result = new Map<string, LlmClassification>();
      if (rows.length === 0) return result;

      const allowed = new Set(allowedCategoryNames);
      const allowedCategoriesJson = JSON.stringify(allowedCategoryNames);
      const transactionsJson = JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          counterparty: r.counterparty,
          description: r.description,
          amount: r.amount,
          transactionType: r.transactionType,
        })),
      );
      const userText = buildGeminiUserPrompt(
        allowedCategoriesJson,
        transactionsJson,
      );

      const url = `${base}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: GEMINI_SYSTEM_PROMPT }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userText }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
              responseSchema: GEMINI_RESPONSE_SCHEMA,
            },
          }),
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Gemini HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }

      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text =
        json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (!text) {
        throw new Error("Gemini: empty response text");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error("Gemini: response is not valid JSON");
      }
      if (!Array.isArray(parsed)) {
        throw new Error("Gemini: expected JSON array");
      }

      for (const item of parsed) {
        if (item == null || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const id = o.id;
        const categoryName = o.categoryName;
        const confidence = o.confidence;
        const rationale =
          typeof o.rationale === "string" ? o.rationale : undefined;
        if (typeof id !== "string" || !id) continue;
        if (typeof categoryName !== "string" || !categoryName) continue;
        if (typeof confidence !== "number" || Number.isNaN(confidence)) continue;
        if (!allowed.has(categoryName)) continue;
        result.set(id, { categoryName, confidence, rationale });
      }

      return result;
    },
  };
}

export function canonicalToCategorisationRow(
  tx: CanonicalTransaction,
): CategorisationRowInput {
  const typeRaw = tx.raw?.Type ?? tx.raw?.type;
  const transactionType =
    typeof typeRaw === "string" ? typeRaw : String(typeRaw ?? "");
  return {
    id: tx.external_id,
    counterparty: tx.counterparty?.trim() ?? "",
    description: tx.description?.trim() ?? "",
    amount: tx.amount,
    transactionType,
  };
}
