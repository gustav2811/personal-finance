import type { ConsumptionBatch, JsonObject } from "../ismrt/map.js";
import { johannesburgParts } from "../ismrt/dates.js";
import { SubrequestBudget } from "../jobs/budget.js";
import { InvalidSourceDataError } from "../errors.js";
import type { TuyaLogEntry } from "./client.js";

export const TUYA_SOURCE = "tuya";
export const TUYA_MEASUREMENT_TARGET = "lelit-bianca";
export const TUYA_CODES = [
  "switch_1",
  "cur_power",
  "add_ele",
  "cur_current",
  "cur_voltage",
] as const;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TuyaCode = (typeof TUYA_CODES)[number];
export type TuyaLogsByCode = Record<TuyaCode, TuyaLogEntry[]>;

export function tuyaDayWindow(date: string): { start: string; end: string } {
  const dayStart = parseDate(date);
  const start = new Date(dayStart.getTime() - SAST_OFFSET_MS);
  const end = new Date(start.getTime() + DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function tuyaPlanDates(now: Date): string[] {
  const today = johannesburgParts(now.toISOString());
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  // The seventh calendar day is outside Tuya's seven-day event-retention window
  // by the time the 07:00 UTC cron runs, so use offsets 1 through 6.
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(todayUtc - (index + 1) * DAY_MS);
    return date.toISOString().slice(0, 10);
  });
}

export function assertTuyaDayClosed(date: string, now: Date): void {
  parseDate(date);
  const today = johannesburgParts(now.toISOString());
  const todayDate = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  )
    .toISOString()
    .slice(0, 10);
  if (date >= todayDate) {
    throw new Error(`Tuya day is not closed: ${date}`);
  }
}

export function aggregateTuyaKwh(entries: TuyaLogEntry[]): number {
  let millikwh = 0;
  for (const entry of entries) {
    const value = Number(entry.value);
    if (!Number.isFinite(value)) {
      throw new InvalidSourceDataError(
        `invalid Tuya add_ele value: ${entry.value}`,
      );
    }
    millikwh += value;
  }
  const kwh = millikwh / 1000;
  if (!Number.isFinite(kwh)) {
    throw new InvalidSourceDataError("invalid Tuya daily kWh");
  }
  return kwh;
}

export function serializeTuyaLogs(entries: TuyaLogEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.event_time - right.event_time);
  if (sorted.length === 0) return "";
  return `${sorted.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function tuyaRawKey(deviceId: string, date: string, code: TuyaCode): string {
  return `tuya/${deviceId}/date=${date}/${code}.ndjson.gz`;
}

export function tuyaSuccessKey(deviceId: string, date: string): string {
  return `tuya/${deviceId}/date=${date}/_SUCCESS`;
}

export async function writeTuyaRawFiles(
  bucket: R2Bucket,
  deviceId: string,
  date: string,
  logsByCode: Partial<TuyaLogsByCode>,
  budget: SubrequestBudget,
  codes: readonly TuyaCode[] = TUYA_CODES,
): Promise<Record<TuyaCode, number>> {
  const counts = Object.fromEntries(
    TUYA_CODES.map((code) => [code, logsByCode[code]?.length ?? 0]),
  ) as Record<TuyaCode, number>;
  for (const code of codes) {
    const entries = logsByCode[code] ?? [];
    counts[code] = entries.length;
    const key = tuyaRawKey(deviceId, date, code);
    const compressed = await gzipText(serializeTuyaLogs(entries));
    budget.internal("r2:put");
    await bucket.put(key, compressed, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
    });
  }
  return counts;
}

export async function readTuyaRawFile(
  bucket: R2Bucket,
  key: string,
  budget: SubrequestBudget,
): Promise<TuyaLogEntry[]> {
  budget.internal("r2:get");
  const object = await bucket.get(key);
  if (!object) throw new Error(`Missing R2 object: ${key}`);
  const decompressed = object.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(decompressed).text();
  if (!text) return [];
  return text
    .trimEnd()
    .split("\n")
    .map((line, index) => parseRawLogEntry(line, key, index));
}

export function buildTuyaConsumptionBatch(input: {
  deviceId: string;
  date: string;
  logsByCode: TuyaLogsByCode;
  startedAt: string;
  finishedAt: string;
}): ConsumptionBatch {
  const window = tuyaDayWindow(input.date);
  const allLogs = TUYA_CODES.flatMap((code) => input.logsByCode[code]);
  const sourceRecordId = `tuya:day:${input.deviceId}:${input.date}`;
  const kwh = aggregateTuyaKwh(input.logsByCode.add_ele);
  const eventCounts = Object.fromEntries(
    TUYA_CODES.map((code) => [code, input.logsByCode[code].length]),
  );

  const device: JsonObject = {
    source: TUYA_SOURCE,
    external_id: input.deviceId,
    kind: "smart_plug",
    name: "BNETA espresso smart plug",
    utility_type: "electricity",
    location: "home",
    timezone: "Africa/Johannesburg",
    parent_source: null,
    parent_external_id: null,
    metadata: {
      device_role: "espresso_machine",
      tuya_device_id: input.deviceId,
    },
  };

  return {
    devices: [device],
    raw_events: [],
    readings: [
      {
        source: TUYA_SOURCE,
        source_record_id: sourceRecordId,
        period_start: window.start,
        period_end: window.end,
        metric: "energy",
        measurement_target: TUYA_MEASUREMENT_TARGET,
        value: kwh,
        unit: "kWh",
        quality: "measured",
        device_source: TUYA_SOURCE,
        device_external_id: input.deviceId,
        metadata: {
          source_code: "add_ele",
          event_counts: eventCounts,
          raw_r2_prefix: `tuya/${input.deviceId}/date=${input.date}/`,
        },
      },
    ],
    ledger_entries: [],
    documents: [],
    ingestion_run: {
      source: TUYA_SOURCE,
      runner: "investments-ingest-consumer",
      status: "succeeded",
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      window_start: window.start,
      window_end: window.end,
      rows_fetched: allLogs.length,
      rows_written: 1,
      metadata: {
        device_id: input.deviceId,
        date: input.date,
        event_counts: eventCounts,
      },
      run_key: `tuya:${input.deviceId}:${input.date}`,
    },
  };
}

async function gzipText(value: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(value));
  await writer.close();
  return new Response(stream.readable).arrayBuffer();
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidSourceDataError(`invalid Johannesburg date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new InvalidSourceDataError(`invalid Johannesburg date: ${value}`);
  }
  return date;
}

function parseRawLogEntry(
  line: string,
  key: string,
  index: number,
): TuyaLogEntry {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new InvalidSourceDataError(`Invalid Tuya raw JSON at ${key}[${index}]`);
  }
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.event_time !== "number" ||
    !Number.isFinite(value.event_time) ||
    typeof value.value !== "string"
  ) {
    throw new InvalidSourceDataError(`Invalid Tuya raw log at ${key}[${index}]`);
  }
  return {
    code: value.code,
    event_time: value.event_time,
    value: value.value,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
