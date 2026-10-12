import * as XLSX from "xlsx";
import type { CanonicalTransaction, ParserContext } from "./types.js";
import { buildExternalId } from "../lib/external-id.js";

const EXCEL_EPOCH_OFFSET = 25569;

const BANK_CODE = "bank_zero";

const TRANSACTIONS_SHEET_KEYWORD = "Transactions";

const DEFAULT_COLUMNS = {
  date: ["Date", "Transaction Date", "Posting Date"],
  time: ["Time", "Transaction Time", "Posting Time"],
  type: ["Type"],
  description1: ["Description 1", "Description1"],
  description2: ["Description 2", "Description2"],
  amount: ["Amount", "Value", "Transaction Amount"],
  balance: ["Balance", "Running Balance", "Current Balance"],
  fee: ["Fee"],
};

function findColumn(
  row: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const keys = Object.keys(row).map((k) => k.trim());
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase() === c.toLowerCase());
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

function parseLocalEventTime(dateValue: unknown, timeValue: unknown): string | undefined {
  const date = parseDate(dateValue);
  if (!date || timeValue == null || timeValue === "") return undefined;
  let hour: number;
  let minute: number;
  let second = 0;
  if (typeof timeValue === "number" && timeValue >= 0 && timeValue < 1) {
    const seconds = Math.round(timeValue * 86400) % 86400;
    hour = Math.floor(seconds / 3600);
    minute = Math.floor((seconds % 3600) / 60);
    second = seconds % 60;
  } else {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue).trim());
    if (!match) return undefined;
    hour = Number(match[1]);
    minute = Number(match[2]);
    second = Number(match[3] ?? "0");
  }
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+02:00`;
}

function parseAmount(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/\s/g, "").replace(/,/g, "");
    const n = parseFloat(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickTransactionsSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const keyword = TRANSACTIONS_SHEET_KEYWORD.toLowerCase();
  const name = workbook.SheetNames.find((n) =>
    n.toLowerCase().includes(keyword),
  );
  if (!name) return null;
  const sheet = workbook.Sheets[name];
  return sheet ?? null;
}

function toUint8Array(buffer: Uint8Array | Buffer): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

function normalizeTransactionType(typeStr: string): string {
  return typeStr.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Maps Description 1/2 and Type to canonical description, counterparty (merchant), and optional notes. */
function mapBankZeroRowFields(
  typeStr: string,
  desc1: string,
  desc2: string,
): { description: string; counterparty?: string; notes?: string } {
  const t = normalizeTransactionType(typeStr);
  const d1 = desc1.trim();
  const d2 = desc2.trim();

  if (t === "transfer in" || t === "transfer out") {
    const description = d1 ? `[TRANSFER] ${d1}` : "[TRANSFER]";
    return {
      description,
      ...(d1 ? { counterparty: d1 } : {}),
      ...(d2 ? { notes: d2 } : {}),
    };
  }

  // Card purchase, Pay In, Pay Out, and any other type: merchant = Description 1, description = Description 2
  return {
    description: d2 || d1 || "Unknown",
    ...(d1 ? { counterparty: d1 } : {}),
  };
}

export function bankZeroParser(
  buffer: Uint8Array | Buffer,
  ctx: ParserContext,
): CanonicalTransaction[] {
  const u8 = toUint8Array(buffer);
  const workbook = XLSX.read(u8, { type: "array", cellDates: false });
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
  const timeCol = findColumn(first, DEFAULT_COLUMNS.time);
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
    const typeStr = typeCol ? String(row[typeCol] ?? "").trim() : "";
    const eventAt = timeCol ? parseLocalEventTime(row[dateCol], row[timeCol]) : undefined;
    const { description, counterparty, notes } = mapBankZeroRowFields(
      typeStr,
      desc1,
      desc2,
    );
    const balance = balanceCol
      ? (parseAmount(row[balanceCol]) ?? undefined)
      : undefined;
    const feeCol = findColumn(row, DEFAULT_COLUMNS.fee);
    const fee = feeCol ? parseAmount(row[feeCol]) ?? undefined : undefined;

    const external_id = buildExternalId(
      BANK_CODE,
      ctx.account_id,
      date,
      amount,
      [typeStr, desc1, desc2, `row:${i + 2}`].filter(Boolean).join("|"),
    );

    results.push({
      external_id,
      account_id: ctx.account_id,
      date,
      amount,
      ...(fee !== undefined && fee !== 0 ? { fee } : {}),
      currency,
      description,
      counterparty,
      ...(notes !== undefined ? { notes } : {}),
      balance,
      raw: row as Record<string, unknown>,
      meta: {
        bank: BANK_CODE,
        source_email: ctx.source_email,
        filename: ctx.filename,
        ...(eventAt ? { bank_event_at: eventAt, event_precision: "minute" as const } : { event_precision: "day" as const }),
        statement_sheet: workbook.SheetNames.find((name) => name.toLowerCase().includes(TRANSACTIONS_SHEET_KEYWORD.toLowerCase())) ?? TRANSACTIONS_SHEET_KEYWORD,
        statement_row: i + 2,
      },
    });
  }

  return results;
}
