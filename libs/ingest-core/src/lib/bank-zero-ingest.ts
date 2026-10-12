import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestCoreConfig } from "../config.js";
import type { IngestJobPayload } from "../job-payload.js";
import type { BankZeroFinancialObservation } from "../parsers/bank-zero-email.js";
import type { CanonicalTransaction } from "../parsers/types.js";

export type BankZeroReceiptContext = {
  routeKey: string;
  deliveryId: string;
  receivedAt: string;
  rawR2Key: string;
  rawSha256: string;
  envelope?: unknown;
  attachments: Array<{
    filename: string;
    mimetype: string;
    sha256?: string;
    r2Key: string;
  }>;
};

export type BankZeroIngestResult = {
  received_email_id: string;
  observation_id: string;
  household_id: string;
  member_id: string | null;
  account_id: string | null;
  route_status: string;
  status: string;
  outcome: string | null;
};

const clients = new Map<string, SupabaseClient>();

function getClient(config: IngestCoreConfig): SupabaseClient {
  const key = `${config.supabaseUrl}\u0000${config.supabaseServiceRoleKey}`;
  let client = clients.get(key);
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.set(key, client);
  }
  return client;
}

export async function recordBankZeroObservation(
  config: IngestCoreConfig,
  receipt: BankZeroReceiptContext,
  payload: IngestJobPayload,
  observation: BankZeroFinancialObservation,
): Promise<BankZeroIngestResult> {
  const rawValues = {
    subject: payload.subject,
    bodySnippet: (payload.text || payload.html || "").slice(0, 4000),
    attachments: receipt.attachments.map(({ filename, mimetype, sha256 }) => ({
      filename,
      mimetype,
      ...(sha256 ? { sha256 } : {}),
    })),
  };
  const parsedValues = {
    messageClass: observation.messageClass,
    outcome: observation.outcome,
    ...(observation.direction ? { direction: observation.direction } : {}),
    ...(observation.amountMinor !== undefined ? { amountMinor: observation.amountMinor } : {}),
    ...(observation.attemptedAmountMinor !== undefined ? { attemptedAmountMinor: observation.attemptedAmountMinor } : {}),
    ...(observation.paymentMethod ? { paymentMethod: observation.paymentMethod } : {}),
    ...(observation.counterparty ? { counterparty: observation.counterparty } : {}),
    ...(observation.reference ? { reference: observation.reference } : {}),
    ...(observation.accountAlias ? { accountAlias: observation.accountAlias } : {}),
    ...(observation.eventAt ? { eventAt: observation.eventAt } : {}),
    ...(observation.postedOn ? { postedOn: observation.postedOn } : {}),
    ...(observation.balanceMinor !== undefined ? { balanceMinor: observation.balanceMinor } : {}),
    currency: observation.currency,
    ...(observation.eventAt ? { eventPrecision: "minute" } : { eventPrecision: "day" }),
    ...(observation.postedOn ? { postedOn: observation.postedOn } : {}),
    ...(observation.conflict ? { conflict: observation.conflict } : {}),
    ...(observation.reason ? { reason: observation.reason } : {}),
  };

  const { data, error } = await getClient(config).rpc("bank_zero_record_observation_v1", {
    p_route_key: receipt.routeKey,
    p_delivery_id: receipt.deliveryId,
    p_message_id: payload.message_id,
    p_raw_r2_key: receipt.rawR2Key,
    p_raw_sha256: receipt.rawSha256,
    p_received_at: receipt.receivedAt,
    p_receipt_metadata: {
      envelope: receipt.envelope ?? {},
      from: payload.from,
      to: payload.to,
      attachmentPointers: receipt.attachments,
    },
    p_observation: {
      evidenceKey: "message",
      messageClass: observation.messageClass,
      outcome: observation.outcome,
      parserVersion: observation.parserVersion,
      rawValues,
      parsedValues,
      fieldProvenance: observation.sourceFields,
      conflict: observation.conflict,
      reason: observation.reason,
    },
  });
  if (error) throw new Error(`Bank Zero evidence persistence failed: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Bank Zero evidence persistence returned an invalid result");
  }
  return data as BankZeroIngestResult;
}

function minorUnits(amount: number): number {
  const minor = Math.round(Math.abs(amount) * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0 || Math.abs(amount * 100 - minor) > 0.00001) {
    throw new Error("Bank Zero statement amount is not an exact positive minor-unit value");
  }
  return minor;
}

function statementType(type: string): { movementType: string; messageClass: string; paymentMethod?: string } {
  const normalized = type.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.includes("card") && normalized.includes("refund")) return { movementType: "card_refund", messageClass: "statement" };
  if (normalized.includes("card") || normalized.includes("apple pay")) return { movementType: "card_purchase", messageClass: "statement", paymentMethod: "card" };
  if (normalized === "transfer in" || normalized === "transfer out") return { movementType: "transfer_leg", messageClass: "statement" };
  if (normalized.includes("interest")) return { movementType: "interest", messageClass: "statement" };
  if (normalized.includes("fee")) return { movementType: "fee", messageClass: "statement", paymentMethod: "fee" };
  if (normalized.includes("pay in") || normalized.includes("deposit")) return { movementType: "receipt", messageClass: "statement" };
  if (normalized.includes("pay immediately")) return { movementType: "payment", messageClass: "statement", paymentMethod: "immediate_payment" };
  if (normalized.includes("pay out") || normalized.includes("payment")) return { movementType: "payment", messageClass: "statement", paymentMethod: "ordinary_payment" };
  return { movementType: "statement_movement", messageClass: "statement" };
}

/** Persists one occurrence-qualified statement row as durable evidence. */
async function persistBankZeroStatementAmount(
  config: IngestCoreConfig,
  receipt: BankZeroReceiptContext,
  payload: IngestJobPayload,
  row: CanonicalTransaction,
  accountAlias: string,
  attachmentSha256: string,
  amount: number,
  evidenceSuffix = "",
  forcedMovementType?: string,
  accountNumber?: string,
): Promise<BankZeroIngestResult> {
  const sheet = row.meta.statement_sheet;
  const rowNumber = row.meta.statement_row;
  if (!sheet || !rowNumber || !/^[0-9a-f]{64}$/.test(attachmentSha256)) {
    throw new Error("Statement row is missing its durable evidence identity");
  }
  const raw = row.raw ?? {};
  const type = String(raw.Type ?? raw.type ?? "");
  const inferred = statementType(type);
  const movementType = forcedMovementType ?? inferred.movementType;
  const { messageClass, paymentMethod } = inferred;
  const alias = accountAlias.trim();
  const eventAt = row.meta.bank_event_at;
  const amountMinorValue = minorUnits(amount);
  const parsedValues = {
    messageClass,
    outcome: "movement_candidate",
    movementType,
    direction: amount > 0 ? "credit" : "debit",
    amountMinor: amountMinorValue,
    currency: row.currency,
    accountAlias: alias,
    displayDescription: row.description,
    ...(accountNumber ? { accountNumber } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(row.counterparty ? { counterparty: row.counterparty } : {}),
    ...(row.notes ? { reference: row.notes } : {}),
    ...(eventAt ? { eventAt } : {}),
    postedOn: row.date,
    eventPrecision: row.meta.event_precision ?? "day",
    ...(row.balance !== undefined ? { balanceMinor: Math.round(row.balance * 100) } : {}),
    statementContentSha256: attachmentSha256,
    statementSheet: sheet,
    statementRow: rowNumber,
  };
  const observation = {
    evidenceKey: `statement:${attachmentSha256}:${encodeURIComponent(sheet)}:${rowNumber}${evidenceSuffix}`,
    messageClass,
    outcome: "movement_candidate",
    parserVersion: "bank-zero-statement-v2",
    rawValues: {
      subject: payload.subject,
      filename: row.meta.filename,
      sheet,
      row: rowNumber,
      rawRow: raw,
    },
    parsedValues,
    fieldProvenance: {
      amountMinor: "attachment",
      direction: "attachment",
      accountAlias: "attachment",
      postedOn: "attachment",
      ...(eventAt ? { eventAt: "attachment" } : {}),
      ...(row.counterparty ? { counterparty: "attachment" } : {}),
    },
  };
  const { data, error } = await getClient(config).rpc("bank_zero_record_observation_v1", {
    p_route_key: receipt.routeKey,
    p_delivery_id: receipt.deliveryId,
    p_message_id: payload.message_id,
    p_raw_r2_key: receipt.rawR2Key,
    p_raw_sha256: receipt.rawSha256,
    p_received_at: receipt.receivedAt,
    p_receipt_metadata: {
      envelope: receipt.envelope ?? {},
      from: payload.from,
      to: payload.to,
      attachmentPointers: receipt.attachments,
    },
    p_observation: observation,
  });
  if (error) throw new Error(`Bank Zero statement evidence persistence failed: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Bank Zero statement evidence persistence returned an invalid result");
  }
  return data as BankZeroIngestResult;
}

/** Persists one occurrence-qualified statement row and its separately reported fee. */
export async function recordBankZeroStatementRow(
  config: IngestCoreConfig,
  receipt: BankZeroReceiptContext,
  payload: IngestJobPayload,
  row: CanonicalTransaction,
  accountAlias: string,
  attachmentSha256: string,
  accountNumber?: string,
): Promise<BankZeroIngestResult> {
  const result = await persistBankZeroStatementAmount(
      config, receipt, payload, row, accountAlias, attachmentSha256, row.amount, "", undefined, accountNumber,
  );
  if (row.fee !== undefined && row.fee !== 0) {
    await persistBankZeroStatementAmount(
      config, receipt, payload, row, accountAlias, attachmentSha256,
      -Math.abs(row.fee), ":fee", "fee", accountNumber,
    );
  }
  return result;
}
