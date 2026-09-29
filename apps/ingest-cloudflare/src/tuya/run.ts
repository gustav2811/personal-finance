import type { IngestQueueMessageV1 } from "@investments/ingest-core";
import { ConsumptionRpc } from "../ismrt/supabase.js";
import {
  TUYA_CODES,
  assertTuyaDayClosed,
  buildTuyaConsumptionBatch,
  tuyaDayWindow,
  tuyaPlanDates,
  tuyaSuccessKey,
  writeTuyaRawFiles,
  type TuyaLogsByCode,
} from "./day.js";
import { TuyaClient } from "./client.js";

export type TuyaDayMessage = {
  type: "tuya-day";
  deviceId: string;
  date: string;
};

export type ConsumerQueueMessage = IngestQueueMessageV1 | TuyaDayMessage;

export type RoutedQueueMessage =
  | { type: "tuya-day"; message: TuyaDayMessage }
  | { type: "email-ingest"; message: IngestQueueMessageV1 };

export type TuyaEnv = {
  INGEST_BUCKET: R2Bucket;
  TUYA_QUEUE: Queue<TuyaDayMessage>;
  TUYA_DEVICE_ID: string;
  TUYA_ACCESS_ID: string;
  TUYA_ACCESS_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
};

export function isTuyaDayMessage(value: ConsumerQueueMessage): value is TuyaDayMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "tuya-day" &&
    typeof value.deviceId === "string" &&
    typeof value.date === "string"
  );
}

export function routeQueueMessage(message: ConsumerQueueMessage): RoutedQueueMessage {
  if (isTuyaDayMessage(message)) {
    return { type: "tuya-day", message };
  }
  return { type: "email-ingest", message };
}

export async function planTuyaDays(env: TuyaEnv, now: Date): Promise<void> {
  const deviceId = required(env.TUYA_DEVICE_ID, "TUYA_DEVICE_ID");
  for (const date of tuyaPlanDates(now)) {
    const markerKey = tuyaSuccessKey(deviceId, date);
    if (await env.INGEST_BUCKET.head(markerKey)) continue;

    console.log(
      JSON.stringify({
        level: "warn",
        msg: "tuya_day_missing",
        component: "ingest-consumer",
        device_id: deviceId,
        date,
        marker_key: markerKey,
      }),
    );
    await env.TUYA_QUEUE.send({ type: "tuya-day", deviceId, date });
  }
}

export async function handleTuyaDay(
  message: TuyaDayMessage,
  env: TuyaEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<void> {
  const deviceId = required(message.deviceId, "Tuya device id");
  const date = message.date;
  const markerKey = tuyaSuccessKey(deviceId, date);
  if (await env.INGEST_BUCKET.head(markerKey)) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_already_ingested",
        component: "ingest-consumer",
        device_id: deviceId,
        date,
      }),
    );
    return;
  }

  assertTuyaDayClosed(date, now);
  const startedAt = now.toISOString();
  const window = tuyaDayWindow(date);
  const client = new TuyaClient(
    required(env.TUYA_ACCESS_ID, "TUYA_ACCESS_ID"),
    required(env.TUYA_ACCESS_SECRET, "TUYA_ACCESS_SECRET"),
    { fetchImpl },
  );
  await client.authenticate();

  const logsByCode = {} as TuyaLogsByCode;
  const startTime = Date.parse(window.start);
  const endTime = Date.parse(window.end);
  for (const code of TUYA_CODES) {
    logsByCode[code] = await client.reportLogs(deviceId, code, startTime, endTime);
  }

  const eventCounts = await writeTuyaRawFiles(
    env.INGEST_BUCKET,
    deviceId,
    date,
    logsByCode,
  );
  const finishedAt = new Date().toISOString();
  const batch = buildTuyaConsumptionBatch({
    deviceId,
    date,
    logsByCode,
    startedAt,
    finishedAt,
  });
  const reading = batch.readings[0];
  if (!reading) throw new Error("Tuya batch is missing its daily reading");
  await new ConsumptionRpc(
    required(env.SUPABASE_URL, "SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_KEY, "SUPABASE_SERVICE_KEY"),
    fetchImpl,
  ).ingest(batch);

  await env.INGEST_BUCKET.put(
    markerKey,
    JSON.stringify({
      kwh: reading.value,
      events: eventCounts,
      written_at: new Date().toISOString(),
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
  console.log(
    JSON.stringify({
      level: "info",
      msg: "tuya_day_ingested",
      component: "ingest-consumer",
      device_id: deviceId,
      date,
      kwh: reading.value,
      events: eventCounts,
    }),
  );
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`missing ${name}`);
  return value;
}
