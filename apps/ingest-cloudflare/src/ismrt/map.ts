import {
  HOUSEHOLD_TIMEZONE,
  canonicalTimestamp,
  incurredInstant,
  ledgerSourceRecordId,
  type IncurredDateRule,
} from "./dates.js";

export const SOURCE = "ismrt";
const DAY_MS = 24 * 60 * 60 * 1000;
const ENERGY_MEASURE = "forwardActiveEnergy";

export type JsonObject = Record<string, unknown>;

export type ExpenseRow = {
  utilityType: string;
  charge: string | null;
  debit: number | null;
  credit: number | null;
  rate: number | null;
  date: string;
  meterSerial: string | null;
  consumption: number | null;
  reference: string | null;
};

export type DepositRow = {
  date: string;
  credit: number | null;
};

export type MeterInterval = {
  startDate: string;
  endDate: string;
  measures: MeterMeasure[];
};

export type MeterMeasure = {
  name: string;
  consumption: number | null;
  unit: string | null;
  displayName: string | null;
  startValue: number | null;
  endValue: number | null;
};

export type WalletRecord = {
  id: string;
  propertyName: string;
  premiseName: string | null;
  accountReference: string | null;
};

export type MeterRecord = {
  id: string | null;
  serial: string;
};

export type DocumentRow = {
  idKey: string;
  documentNumber: string | null;
  documentDate: string;
  total: number;
};

export type MeterProfile = {
  serial: string;
  intervalMinutes: number;
  intervals: MeterInterval[];
};

export type CaptureInput = {
  wallet: WalletRecord;
  meters: MeterRecord[];
  expenses: ExpenseRow[];
  deposits: DepositRow[];
  invoices: DocumentRow[];
  proofs: DocumentRow[];
  profiles: MeterProfile[];
  windowStart: string;
  windowEnd: string;
  fetchedAt: string;
};

export type ConsumptionBatch = {
  devices: JsonObject[];
  raw_events: JsonObject[];
  readings: JsonObject[];
  ledger_entries: JsonObject[];
  documents: JsonObject[];
  ingestion_run: JsonObject;
};

type Utility = "electricity" | "water" | "wallet";

export async function buildConsumptionBatch(input: CaptureInput): Promise<ConsumptionBatch> {
  const windowEnd = canonicalTimestamp(input.windowEnd);
  const windowStart = canonicalTimestamp(input.windowStart);
  const fetchedAt = canonicalTimestamp(input.fetchedAt);
  const walletId = input.wallet.id;
  const location = input.wallet.propertyName;
  if (!location) {
    throw new Error(`wallet ${walletId} is missing a property name`);
  }
  const waterDeviceId = `water:${walletId}`;
  const devices = buildDevices(input, location, waterDeviceId);
  const rawEvents = await buildRawEvents(input, walletId, windowStart, windowEnd, fetchedAt);
  const expenseRawId = rawRecordId("wallet_expense_transactions", walletId, windowStart, windowEnd);
  const depositRawId = rawRecordId("wallet_deposits", walletId, windowStart, windowEnd);
  const readingResult = buildReadings(input.profiles, walletId, windowStart, windowEnd);
  const ledger = buildLedger(input, walletId, waterDeviceId, windowEnd, expenseRawId, depositRawId);
  const documents = buildDocuments(input, rawEvents);

  const rows = ledger.entries.length + readingResult.readings.length + documents.length;
  return {
    devices,
    raw_events: rawEvents,
    readings: readingResult.readings,
    ledger_entries: ledger.entries,
    documents,
    ingestion_run: {
      source: SOURCE,
      runner: "investments-ingest-consumer",
      status: "succeeded",
      started_at: fetchedAt,
      finished_at: new Date().toISOString(),
      window_start: windowStart,
      window_end: windowEnd,
      rows_fetched: rows,
      rows_written: rows,
      metadata: {
        wallet_id: walletId,
        incurred_date_rule: "daily_close_v1",
        skipped_open_intervals: readingResult.skipped,
        skipped_open_expenses: ledger.skippedOpen,
      },
    },
  };
}

export function mergeBatches(batches: ConsumptionBatch[], fetchedAt: string): ConsumptionBatch {
  if (batches.length === 0) {
    throw new Error("no ISMRT wallets to ingest");
  }
  const first = batches[0];
  if (!first) {
    throw new Error("no ISMRT wallets to ingest");
  }
  if (batches.length === 1) return first;
  const rows = batches.reduce(
    (sum, batch) => sum + batch.ledger_entries.length + batch.readings.length + batch.documents.length,
    0,
  );
  return {
    devices: batches.flatMap((batch) => batch.devices),
    raw_events: batches.flatMap((batch) => batch.raw_events),
    readings: batches.flatMap((batch) => batch.readings),
    ledger_entries: batches.flatMap((batch) => batch.ledger_entries),
    documents: batches.flatMap((batch) => batch.documents),
    ingestion_run: {
      ...first.ingestion_run,
      started_at: canonicalTimestamp(fetchedAt),
      finished_at: new Date().toISOString(),
      rows_fetched: rows,
      rows_written: rows,
      metadata: {
        wallet_ids: batches.map((batch) => batch.ingestion_run.metadata),
        incurred_date_rule: "daily_close_v1",
      },
    },
  };
}

function buildDevices(input: CaptureInput, location: string, waterDeviceId: string): JsonObject[] {
  const walletId = input.wallet.id;
  const serials = new Set(input.meters.map((meter) => meter.serial));
  for (const row of input.expenses) {
    if (utilityOf(row.utilityType) === "electricity") {
      if (!row.meterSerial) throw new Error("electricity expense is missing a meter serial");
      serials.add(row.meterSerial);
    }
  }
  if (serials.size === 0) {
    throw new Error(`wallet ${walletId} has no electricity meter`);
  }
  const devices: JsonObject[] = [
    {
      source: SOURCE,
      external_id: walletId,
      kind: "wallet",
      name: `ISMRT wallet ${walletId}`,
      utility_type: "wallet",
      location,
      timezone: HOUSEHOLD_TIMEZONE,
      parent_source: null,
      parent_external_id: null,
      metadata: {
        account_reference: input.wallet.accountReference,
        premise_name: input.wallet.premiseName,
      },
    },
  ];
  for (const serial of serials) {
    const meter = input.meters.find((candidate) => candidate.serial === serial);
    devices.push({
      source: SOURCE,
      external_id: serial,
      kind: "utility_meter",
      name: `ISMRT meter ${serial}`,
      utility_type: "electricity",
      location,
      timezone: HOUSEHOLD_TIMEZONE,
      parent_source: SOURCE,
      parent_external_id: walletId,
      metadata: { ismrt_meter_id: meter?.id ?? null },
    });
  }
  devices.push({
    source: SOURCE,
    external_id: waterDeviceId,
    kind: "utility_stream",
    name: "ISMRT water billing",
    utility_type: "water",
    location,
    timezone: HOUSEHOLD_TIMEZONE,
    parent_source: SOURCE,
    parent_external_id: walletId,
    metadata: { meter_type: "invoice_billing" },
  });
  return devices;
}

function buildReadings(
  profiles: MeterProfile[],
  walletId: string,
  windowStart: string,
  windowEnd: string,
): { readings: JsonObject[]; skipped: number } {
  const readings: JsonObject[] = [];
  let skipped = 0;
  for (const profile of profiles) {
    const rawRecordIdValue = rawRecordId(
      `meter_profile:${profile.serial}:${profile.intervalMinutes}`,
      walletId,
      windowStart,
      windowEnd,
    );
    for (const interval of profile.intervals) {
      const periodStart = canonicalTimestamp(interval.startDate);
      const periodEnd = canonicalTimestamp(interval.endDate);
      const measure = interval.measures.find((candidate) => candidate.name === ENERGY_MEASURE);
      if (!measure || measure.consumption === null) {
        skipped += 1;
        continue;
      }
      if (periodEnd > windowEnd) {
        skipped += 1;
        continue;
      }
      if (new Date(periodEnd).getTime() - new Date(periodStart).getTime() !== DAY_MS) {
        throw new Error(`meter ${profile.serial} returned a non-daily interval ending ${periodEnd}`);
      }
      if (!measure.unit) {
        throw new Error(`meter ${profile.serial} energy measure is missing a unit`);
      }
      readings.push({
        source: SOURCE,
        source_record_id: `meter_profile:${profile.serial}:${periodStart}:${periodEnd}:${ENERGY_MEASURE}`,
        period_start: periodStart,
        period_end: periodEnd,
        metric: "energy",
        measurement_target: "whole_home",
        value: measure.consumption,
        unit: measure.unit,
        quality: "measured",
        device_source: SOURCE,
        device_external_id: profile.serial,
        raw_source: SOURCE,
        raw_record_id: rawRecordIdValue,
        metadata: {
          measure_name: ENERGY_MEASURE,
          display_name: measure.displayName,
          start_value: measure.startValue,
          end_value: measure.endValue,
          profile_interval_minutes: profile.intervalMinutes,
        },
      });
    }
  }
  return { readings, skipped };
}

function buildLedger(
  input: CaptureInput,
  walletId: string,
  waterDeviceId: string,
  windowEnd: string,
  expenseRawId: string,
  depositRawId: string,
): { entries: JsonObject[]; skippedOpen: number } {
  const entries: JsonObject[] = [];
  const occurrences = new Map<string, number>();
  const waterQuantities = new Set<string>();
  let skippedOpen = 0;

  for (const row of input.expenses) {
    const postedAt = canonicalTimestamp(row.date);
    if (postedAt > windowEnd) {
      skippedOpen += 1;
      continue;
    }
    const utility = utilityOf(row.utilityType);
    const direction = directionOf(row.debit, row.credit);
    const amount = direction === "debit" ? requiredNumber(row.debit, "debit") : requiredNumber(row.credit, "credit");
    const entryType = utility === "wallet" ? "fee" : "usage_charge";
    const incurred = incurredInstant({ postedAt, utility, description: row.charge });
    const quantity = quantityFor(row, utility, direction, waterQuantities);
    entries.push(
      ledgerEntry({
        utility,
        entryType,
        direction,
        amount,
        postedAt,
        occurredAt: incurred.occurredAt,
        rule: incurred.rule,
        description: row.charge,
        reference: row.reference,
        quantity: quantity.value,
        quantityUnit: quantity.unit,
        rate: row.rate,
        deviceExternalId: deviceFor(utility, row.meterSerial, walletId, waterDeviceId),
        rawRecordId: expenseRawId,
        occurrence: nextOccurrence(occurrences, utility, entryType, postedAt, direction, amount),
        metadata: {
          meter_serial: row.meterSerial,
          incurred_date_rule: incurred.rule,
          ...quantity.metadata,
        },
      }),
    );
  }

  for (const row of input.deposits) {
    const postedAt = canonicalTimestamp(row.date);
    if (postedAt > windowEnd) {
      skippedOpen += 1;
      continue;
    }
    const amount = requiredNumber(row.credit, "credit");
    const incurred = incurredInstant({ postedAt, utility: "wallet", description: "PURCHASE" });
    entries.push(
      ledgerEntry({
        utility: "wallet",
        entryType: "deposit",
        direction: "credit",
        amount,
        postedAt,
        occurredAt: incurred.occurredAt,
        rule: incurred.rule,
        description: "PURCHASE",
        reference: null,
        quantity: null,
        quantityUnit: null,
        rate: null,
        deviceExternalId: walletId,
        rawRecordId: depositRawId,
        occurrence: nextOccurrence(occurrences, "wallet", "deposit", postedAt, "credit", amount),
        metadata: { incurred_date_rule: incurred.rule },
      }),
    );
  }

  return { entries, skippedOpen };
}

function buildDocuments(input: CaptureInput, rawEvents: JsonObject[]): JsonObject[] {
  const documents: JsonObject[] = [];
  for (const [documentType, rows, eventType] of [
    ["invoice", input.invoices, "wallet_invoices"],
    ["proof_of_payment", input.proofs, "wallet_proof_of_payments"],
  ] as const) {
    const rawRecordId = rawEvents.find((event) => event.event_type === eventType)?.source_record_id;
    for (const [index, row] of rows.entries()) {
      const postedAt = canonicalTimestamp(row.documentDate);
      documents.push({
        source: SOURCE,
        source_record_id: `${documentType}:${row.idKey}`,
        document_type: documentType,
        document_number: row.documentNumber,
        document_date: postedAt.slice(0, 10),
        total: row.total,
        currency: "ZAR",
        file_name: null,
        storage_path: null,
        raw_source: SOURCE,
        raw_record_id: rawRecordId ?? null,
        metadata: {
          id_key: row.idKey,
          source_row_index: index,
          document_timestamp: postedAt,
        },
      });
    }
  }
  return documents;
}

async function buildRawEvents(
  input: CaptureInput,
  walletId: string,
  windowStart: string,
  windowEnd: string,
  fetchedAt: string,
): Promise<JsonObject[]> {
  const events: Array<{ eventType: string; payload: unknown; eventAt: string | null }> = [
    { eventType: "user_wallets", payload: input.wallet, eventAt: null },
    { eventType: "meters", payload: input.meters, eventAt: null },
    { eventType: "wallet_expense_transactions", payload: input.expenses, eventAt: windowStart },
    { eventType: "wallet_deposits", payload: input.deposits, eventAt: windowStart },
    { eventType: "wallet_invoices", payload: input.invoices, eventAt: windowStart },
    { eventType: "wallet_proof_of_payments", payload: input.proofs, eventAt: windowStart },
  ];
  for (const profile of input.profiles) {
    events.push({
      eventType: `meter_profile:${profile.serial}:${profile.intervalMinutes}`,
      payload: profile,
      eventAt: windowStart,
    });
  }
  return Promise.all(
    events.map(async (event) => ({
      source: SOURCE,
      source_record_id: rawRecordId(event.eventType, walletId, windowStart, windowEnd),
      event_type: event.eventType,
      event_at: event.eventAt,
      fetched_at: fetchedAt,
      payload_hash: await payloadHash(event.payload),
      payload: event.payload,
      metadata: {
        wallet_id: walletId,
        window_start: windowStart,
        window_end: windowEnd,
      },
    })),
  );
}

function ledgerEntry(input: {
  utility: Utility;
  entryType: string;
  direction: "debit" | "credit";
  amount: number;
  postedAt: string;
  occurredAt: string;
  rule: IncurredDateRule;
  description: string | null;
  reference: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  rate: number | null;
  deviceExternalId: string;
  rawRecordId: string;
  occurrence: number;
  metadata: JsonObject;
}): JsonObject {
  return {
    source: SOURCE,
    source_record_id: ledgerSourceRecordId({
      utility: input.utility,
      entryType: input.entryType,
      postedAt: input.postedAt,
      direction: input.direction,
      amount: input.amount,
      occurrence: input.occurrence,
    }),
    utility_type: input.utility,
    entry_type: input.entryType,
    direction: input.direction,
    amount: input.amount,
    currency: "ZAR",
    quantity: input.quantity,
    quantity_unit: input.quantityUnit,
    rate: input.rate,
    occurred_at: input.occurredAt,
    posted_at: input.postedAt,
    description: input.description,
    reference: input.reference,
    device_source: SOURCE,
    device_external_id: input.deviceExternalId,
    raw_source: SOURCE,
    raw_record_id: input.rawRecordId,
    metadata: input.metadata,
  };
}

function quantityFor(
  row: ExpenseRow,
  utility: Utility,
  direction: "debit" | "credit",
  seenWater: Set<string>,
): { value: number | null; unit: string | null; metadata: JsonObject } {
  if (row.consumption !== null) {
    return {
      value: row.consumption,
      unit: utility === "electricity" ? "kWh" : null,
      metadata: {},
    };
  }
  if (utility !== "water") return { value: null, unit: null, metadata: {} };
  const extracted = quantityFromReference(row.reference);
  if (extracted !== null && direction === "debit" && row.reference && !seenWater.has(row.reference)) {
    seenWater.add(row.reference);
    return {
      value: extracted,
      unit: "kl",
      metadata: { quantity_extracted_from: "reference" },
    };
  }
  return {
    value: null,
    unit: null,
    metadata: { quantity_suppressed_reason: "duplicate_or_credit_water_ledger_row" },
  };
}

function quantityFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const match = reference.match(/Usage\s+([0-9]+(?:\.[0-9]+)?)\s+kl\b/);
  return match ? Number(match[1]) : null;
}

function deviceFor(
  utility: Utility,
  meterSerial: string | null,
  walletId: string,
  waterDeviceId: string,
): string {
  if (utility === "electricity") {
    if (!meterSerial) throw new Error("electricity expense is missing a meter serial");
    return meterSerial;
  }
  if (utility === "wallet") return walletId;
  return waterDeviceId;
}

function nextOccurrence(
  seen: Map<string, number>,
  utility: string,
  entryType: string,
  postedAt: string,
  direction: string,
  amount: number,
): number {
  const key = `${utility}:${entryType}:${postedAt}:${direction}:${amount.toFixed(4)}`;
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);
  return occurrence;
}

function utilityOf(value: string): Utility {
  if (value === "Electricity") return "electricity";
  if (value === "Water") return "water";
  if (value === "ismrt! Wallet Charges") return "wallet";
  throw new Error(`unsupported ISMRT utility type: ${value}`);
}

function directionOf(debit: number | null, credit: number | null): "debit" | "credit" {
  if (debit !== null && credit !== null) {
    throw new Error("expense row has both debit and credit");
  }
  if (debit !== null) return "debit";
  if (credit !== null) return "credit";
  throw new Error("expense row has neither debit nor credit");
}

function requiredNumber(value: number | null, field: string): number {
  if (value === null || !Number.isFinite(value)) {
    throw new Error(`expected numeric ${field}`);
  }
  return value;
}

function rawRecordId(eventType: string, walletId: string, windowStart: string, windowEnd: string): string {
  return `${eventType}:${walletId}:${windowStart}:${windowEnd}`;
}

async function payloadHash(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(payload)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortValue(record[key]);
    return sorted;
  }
  return value;
}
