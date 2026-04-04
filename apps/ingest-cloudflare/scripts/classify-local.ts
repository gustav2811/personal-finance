/**
 * Dry-run the same categorisation pipeline as the Cloudflare consumer (ingest-core),
 * on a Bank Zero XLS/XLSX from disk.
 *
 * **Never posts transactions to FinWise** — only GET /transaction-categories (and Gemini).
 * `finwise.transactions.create` is replaced with a function that always throws so any
 * accidental export fails loudly.
 *
 * Usage (from apps/ingest-cloudflare):
 *   yarn classify-local [path-to-file.xls] [path-to-output.json]
 *
 * Writes `<stem>.classify.json` next to the input file when the second argument is omitted.
 *
 * Loads env from repo root `.env` first, then `apps/ingest-cloudflare/.env` (overrides).
 *
 * Required: FINWISE_API_KEY.
 * Optional: BANK_ZERO_ACCOUNT_ID — defaults to repo `account.map.json` entry
 *   pattern "Transaction" + accountNumber "80204387707" (your main transactional account).
 * Optional: BANK_ZERO_ACCOUNT_MAP — defaults to the same file when unset.
 * Optional: GEMINI_API_KEY, GEMINI_MODEL (default matches consumer), CATEGORISATION_*.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  categoriseTransactions,
  categoriesToIdNameMap,
  createFinwiseClient,
  fetchAllTransactionCategories,
  getParserForBank,
  parseBankZeroAccountMapJson,
  validateAll,
  type BankZeroAccountMapping,
  type IngestCoreConfig,
} from "@investments/ingest-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(__dirname, "../.env") });

/** Same row as `account.map.json` lines 14–18 (primary Transaction account). */
const DEFAULT_TRANSACTION_ACCOUNT_NUMBER = "80204387707";

function bankZeroAccountIdFromRepoMap(): string | null {
  try {
    const raw = readFileSync(path.join(repoRoot, "account.map.json"), "utf8");
    const list = parseBankZeroAccountMapJson(raw);
    const primary = list.find(
      (e) =>
        e.pattern === "Transaction" &&
        e.accountNumber === DEFAULT_TRANSACTION_ACCOUNT_NUMBER,
    );
    if (primary) return primary.accountId;
    const anyTx = list.find((e) => e.pattern === "Transaction");
    return anyTx?.accountId ?? null;
  } catch {
    return null;
  }
}

function loadBankZeroAccountMap(): BankZeroAccountMapping[] {
  if (process.env.BANK_ZERO_ACCOUNT_MAP !== undefined) {
    return parseBankZeroAccountMapJson(
      process.env.BANK_ZERO_ACCOUNT_MAP ?? "[]",
    );
  }
  try {
    const raw = readFileSync(path.join(repoRoot, "account.map.json"), "utf8");
    return parseBankZeroAccountMapJson(raw);
  } catch {
    return [];
  }
}

/** Block any code path from creating FinWise transactions during local classify. */
function blockFinwiseTransactionCreates(
  finwise: ReturnType<typeof createFinwiseClient>,
): void {
  finwise.transactions.create = async function classifyLocalBlockedCreate() {
    throw new Error(
      "classify-local: FinWise transactions.create is disabled (dry run only). " +
        "This script must not export/post transactions.",
    );
  };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function createLogger(): {
  info: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
} {
  const line = (level: string, o: unknown, msg?: string) => {
    const rest =
      typeof o === "object" && o !== null && !Array.isArray(o)
        ? (o as Record<string, unknown>)
        : { detail: o };
    console.log(JSON.stringify({ level, msg: msg ?? "", ...rest }, null, 0));
  };
  return {
    info: (o, m) => line("info", o, m),
    warn: (o, m) => line("warn", o, m),
    error: (o, m) => line("error", o, m),
  };
}

function defaultClassifyJsonPath(inputPath: string): string {
  const { dir, name } = path.parse(inputPath);
  return path.join(dir, `${name}.classify.json`);
}

async function main(): Promise<void> {
  const defaultFile = path.join(
    repoRoot,
    "ingest_b6763cd5-5581-4041-8947-51da6eac19da_files_1.xls",
  );
  const xlsPath = path.resolve(process.argv[2] ?? defaultFile);
  const jsonOutPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : defaultClassifyJsonPath(xlsPath);

  const finwiseApiKey = requireEnv("FINWISE_API_KEY");

  const bankZeroAccountId =
    process.env.BANK_ZERO_ACCOUNT_ID?.trim() || bankZeroAccountIdFromRepoMap();
  if (!bankZeroAccountId) {
    console.error(
      "Set BANK_ZERO_ACCOUNT_ID or add account.map.json at repo root (Transaction account).",
    );
    process.exit(1);
  }

  const bankZeroAccountMap = loadBankZeroAccountMap();
  const bankZeroAccountIdSource = process.env.BANK_ZERO_ACCOUNT_ID?.trim()
    ? "env"
    : "account.map.json";
  const bankZeroMapSource =
    process.env.BANK_ZERO_ACCOUNT_MAP !== undefined
      ? "env"
      : "account.map.json";

  const cfg: IngestCoreConfig = {
    finwiseApiKey,
    finwiseBaseUrl:
      process.env.FINWISE_BASE_URL?.trim() || "https://api.finwiseapp.io",
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_KEY ?? "",
    bankZeroAccountId,
    bankZeroAccountMap,
    uploadToFinwise: false,
    categorisationEnabled: true,
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3-flash-preview",
    geminiApiBase:
      process.env.GEMINI_API_BASE?.trim() ||
      "https://generativelanguage.googleapis.com",
    categorisationLlmTimeoutMs: parseInt(
      process.env.CATEGORISATION_LLM_TIMEOUT_MS ?? "120000",
      10,
    ),
    categorisationMinConfidence: parseFloat(
      process.env.CATEGORISATION_MIN_CONFIDENCE ?? "0.35",
    ),
  };

  const buf = readFileSync(xlsPath);
  const parser = getParserForBank("bank_zero");
  if (!parser) {
    console.error("No bank_zero parser registered");
    process.exit(1);
  }

  const filename = path.basename(xlsPath);
  const parsed = await Promise.resolve(
    parser(buf, {
      bank: "bank_zero",
      source_email: "local-classify@example.test",
      filename,
      account_id: bankZeroAccountId,
    }),
  );

  const { valid, invalid } = validateAll(parsed);

  if (valid.length === 0) {
    console.error("No valid rows to classify");
    process.exit(1);
  }

  const finwise = createFinwiseClient(cfg.finwiseApiKey, cfg.finwiseBaseUrl, {
    error: (msg, meta) => console.error(JSON.stringify({ msg, meta })),
  });
  blockFinwiseTransactionCreates(finwise);

  const log = createLogger();
  const classified = await categoriseTransactions(cfg, finwise, valid, log);

  const finwiseCategories = await fetchAllTransactionCategories(finwise);
  const categoryIdToName = categoriesToIdNameMap(finwiseCategories);

  const summary = {
    rule: classified.filter((t) => t.classification_source === "rule").length,
    llm: classified.filter((t) => t.classification_source === "llm").length,
    llm_error: classified.filter((t) => t.classification_source === "llm_error")
      .length,
    none: classified.filter((t) => t.classification_source === "none").length,
    with_category_id: classified.filter((t) => t.transaction_category_id)
      .length,
  };

  const inputMeta = {
    file: xlsPath,
    bank_zero_account_id: bankZeroAccountId,
    bank_zero_account_id_source: bankZeroAccountIdSource,
    bank_zero_map_source: bankZeroMapSource,
    rows_parsed: parsed.length,
    rows_valid: valid.length,
    rows_invalid: invalid.length,
    gemini_configured: cfg.geminiApiKey.length > 0,
  };

  const rows = classified.map((tx, index) => {
    const cid = tx.transaction_category_id ?? null;
    return {
      index,
      external_id: tx.external_id,
      date: tx.date,
      amount: tx.amount,
      currency: tx.currency,
      counterparty: tx.counterparty ?? null,
      description: tx.description,
      balance: tx.balance ?? null,
      transaction_category_id: cid,
      transaction_category_name:
        cid !== null ? (categoryIdToName.get(cid) ?? null) : null,
      classification_source: tx.classification_source ?? null,
      classification_confidence: tx.classification_confidence ?? null,
      meta: tx.meta,
    };
  });

  const report = {
    generated_at: new Date().toISOString(),
    input: inputMeta,
    summary,
    rows,
  };

  writeFileSync(jsonOutPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ...inputMeta,
        summary,
        results_json: jsonOutPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
