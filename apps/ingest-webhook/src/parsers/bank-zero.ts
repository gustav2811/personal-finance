import * as XLSX from "xlsx";
import type { CanonicalTransaction, ParserContext } from "./types.js";
import { buildExternalId } from "../lib/external-id.js";

const EXCEL_EPOCH_OFFSET = 25569;

const BANK_CODE = "bank_zero";

/** Bank Zero statement: use sheet whose name includes "Transactions" (not "Summary"). */
const TRANSACTIONS_SHEET_KEYWORD = "Transactions";

/** Column names as in the actual XLSX: Date, Day, Time, Type, Description 1, Description 2, Fee, Amount, Balance, Has Attachments */
const DEFAULT_COLUMNS = {
  date: ["Date", "Transaction Date", "Posting Date"],
  type: ["Type"],
  description1: ["Description 1", "Description1"],
  description2: ["Description 2", "Description2"],
  amount: ["Amount", "Value", "Transaction Amount"],
  balance: ["Balance", "Running Balance", "Current Balance"],
  fee: ["Fee"],
};

function findColumn(
  row: Record<string, unknown>,
  candidates: string[]
): string | undefined {
  const keys = Object.keys(row).map((k) => k.trim());
  for (const c of candidates) {
    const found = keys.find(
      (k) => k.toLowerCase() === c.toLowerCase()
    );
    if (found) return found;
  }
  return undefined;
}

function parseDate(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string") {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (typeof val === "number" && val >= 1) {
    const date = new Date((val - EXCEL_EPOCH_OFFSET) * 86400 * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

/** Handles "1 500.00" and "-1 500.00" (space as thousands separator). */
function parseAmount(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/\s/g, "").replace(/,/g, ".");
    const n = parseFloat(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickTransactionsSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const keyword = TRANSACTIONS_SHEET_KEYWORD.toLowerCase();
  const name = workbook.SheetNames.find((n) =>
    n.toLowerCase().includes(keyword)
  );
  if (!name) return null;
  const sheet = workbook.Sheets[name];
  return sheet ?? null;
}

export function bankZeroParser(
  buffer: Buffer,
  ctx: ParserContext
): CanonicalTransaction[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = pickTransactionsSheet(workbook);
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (data.length === 0) return [];

  const results: CanonicalTransaction[] = [];
  const first = data[0] as Record<string, unknown>;
  const dateCol = findColumn(first, DEFAULT_COLUMNS.date);
  const typeCol = findColumn(first, DEFAULT_COLUMNS.type);
  const desc1Col = findColumn(first, DEFAULT_COLUMNS.description1);
  const desc2Col = findColumn(first, DEFAULT_COLUMNS.description2);
  const amountCol = findColumn(first, DEFAULT_COLUMNS.amount);
  const balanceCol = findColumn(first, DEFAULT_COLUMNS.balance);

  if (!dateCol || !amountCol) {
    return [];
  }

  const currency = "ZAR";

  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown>;
    const date = parseDate(row[dateCol]);
    const amount = parseAmount(row[amountCol]);
    if (date == null || amount == null) continue;

    const desc1 = desc1Col ? String(row[desc1Col] ?? "").trim() : "";
    const desc2 = desc2Col ? String(row[desc2Col] ?? "").trim() : "";
    const description = desc2 || desc1 || "Unknown";
    const counterparty = desc1 || undefined;
    const typeStr = typeCol ? String(row[typeCol] ?? "").trim() : "";
    const balance = balanceCol ? parseAmount(row[balanceCol]) ?? undefined : undefined;

    const external_id = buildExternalId(
      BANK_CODE,
      ctx.account_id,
      date,
      amount,
      [typeStr, desc1, desc2].filter(Boolean).join("|")
    );

    results.push({
      external_id,
      account_id: ctx.account_id,
      date,
      amount,
      currency,
      description,
      counterparty,
      balance,
      raw: row as Record<string, unknown>,
      meta: {
        bank: BANK_CODE,
        source_email: ctx.source_email,
        filename: ctx.filename,
      },
    });
  }

  return results;
}
