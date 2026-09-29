import { ConsumptionRpc } from "../ismrt/supabase.js";
import {
  SubrequestBudget,
  SubrequestBudgetExceededError,
} from "../jobs/budget.js";
import type { Job } from "../jobs/jobs.js";
import {
  TUYA_CODES,
  assertTuyaDayClosed,
  buildTuyaConsumptionBatch,
  readTuyaRawFile,
  tuyaRawKey,
  tuyaDayWindow,
  tuyaPlanDates,
  tuyaSuccessKey,
  writeTuyaRawFiles,
  type TuyaCode,
  type TuyaLogsByCode,
} from "./day.js";
import { TuyaClient } from "./client.js";

export type TuyaDayMessage = {
  type: "tuya-day";
  deviceId: string;
  date: string;
  codes?: TuyaCode[];
};

export type TuyaEnv = {
  INGEST_BUCKET: R2Bucket;
  JOBS_QUEUE: Queue<Job>;
  TUYA_DEVICE_ID: string;
  TUYA_ACCESS_ID: string;
  TUYA_ACCESS_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
};

export async function planTuyaDays(
  env: TuyaEnv,
  now: Date,
  budget = new SubrequestBudget(),
): Promise<void> {
  const deviceId = required(env.TUYA_DEVICE_ID, "TUYA_DEVICE_ID");
  const prefix = `tuya/${deviceId}/date=`;
  const completedDates = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    budget.spend("r2:list");
    const page = await env.INGEST_BUCKET.list({
      prefix,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const object of page.objects) {
      if (!object.key.endsWith("/_SUCCESS")) continue;
      const date = object.key.slice(prefix.length, -"/_SUCCESS".length);
      if (date) completedDates.add(date);
    }
    if (!page.truncated) break;
    if (!page.cursor) throw new Error("R2 list page is truncated without a cursor");
    cursor = page.cursor;
  }

  const missingDates = tuyaPlanDates(now).filter(
    (date) => !completedDates.has(date),
  );
  for (const date of missingDates) {
    const markerKey = tuyaSuccessKey(deviceId, date);

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
  }
  if (missingDates.length > 0) {
    budget.spend("queue:sendBatch");
    await env.JOBS_QUEUE.sendBatch(
      missingDates.map((date) => ({
        body: { type: "tuya-day" as const, deviceId, date },
      })),
    );
  }
}

export async function handleTuyaDay(
  message: TuyaDayMessage,
  env: TuyaEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
  budget = new SubrequestBudget(),
): Promise<void> {
  const deviceId = required(message.deviceId, "Tuya device id");
  const date = message.date;
  const markerKey = tuyaSuccessKey(deviceId, date);
  budget.spend("r2:head");
  if (await env.INGEST_BUCKET.head(markerKey)) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_already_ingested",
        component: "ingest-consumer",
        device_id: deviceId,
        date,
        subrequests_used: budget.used,
      }),
    );
    return;
  }

  assertTuyaDayClosed(date, now);
  const startedAt = now.toISOString();
  const window = tuyaDayWindow(date);
  const requestedCodes = message.codes ?? TUYA_CODES;
  const existingCodes = new Set<TuyaCode>();
  if (message.codes !== undefined) {
    for (const code of requestedCodes) {
      budget.spend("r2:head");
      if (await env.INGEST_BUCKET.head(tuyaRawKey(deviceId, date, code))) {
        existingCodes.add(code);
      }
    }
  }

  const codesToFetch = requestedCodes.filter((code) => !existingCodes.has(code));
  const logsByCode = {} as Partial<TuyaLogsByCode>;
  if (codesToFetch.length > 0) {
    const client = new TuyaClient(
      required(env.TUYA_ACCESS_ID, "TUYA_ACCESS_ID"),
      required(env.TUYA_ACCESS_SECRET, "TUYA_ACCESS_SECRET"),
      { fetchImpl },
    );
    try {
      await client.authenticate();
      const startTime = Date.parse(window.start);
      const endTime = Date.parse(window.end);
      for (const code of codesToFetch) {
        logsByCode[code] = await client.reportLogs(
          deviceId,
          code,
          startTime,
          endTime,
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof SubrequestBudgetExceededError &&
        message.codes === undefined
      ) {
        await enqueueSplitJobs(env, deviceId, date, budget);
        return;
      }
      throw err;
    }
  }

  const eventCounts = await writeTuyaRawFiles(
    env.INGEST_BUCKET,
    deviceId,
    date,
    logsByCode,
    budget,
    codesToFetch,
    existingCodes,
  );
  const allRawFilesExist =
    message.codes === undefined
      ? true
      : await allRawFilesExistForDay(env.INGEST_BUCKET, deviceId, date, budget);
  if (!allRawFilesExist) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_raw_files_pending",
        component: "ingest-consumer",
        device_id: deviceId,
        date,
        events: eventCounts,
        subrequests_used: budget.used,
      }),
    );
    return;
  }

  budget.spend("r2:head");
  if (await env.INGEST_BUCKET.head(markerKey)) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_already_ingested",
        component: "ingest-consumer",
        device_id: deviceId,
        date,
        subrequests_used: budget.used,
      }),
    );
    return;
  }

  const completeLogs = {} as TuyaLogsByCode;
  for (const code of TUYA_CODES) {
    if (logsByCode[code] !== undefined) {
      completeLogs[code] = logsByCode[code];
      continue;
    }
    completeLogs[code] = await readTuyaRawFile(
      env.INGEST_BUCKET,
      tuyaRawKey(deviceId, date, code),
      budget,
    );
    eventCounts[code] = completeLogs[code].length;
  }
  const finishedAt = new Date().toISOString();
  const batch = buildTuyaConsumptionBatch({
    deviceId,
    date,
    logsByCode: completeLogs,
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

  budget.spend("r2:put");
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
      subrequests_used: budget.used,
    }),
  );
}

async function enqueueSplitJobs(
  env: TuyaEnv,
  deviceId: string,
  date: string,
  budget: SubrequestBudget,
): Promise<void> {
  budget.spendReserve("queue:sendBatch");
  await env.JOBS_QUEUE.sendBatch(
    TUYA_CODES.map((code) => ({
      body: { type: "tuya-day" as const, deviceId, date, codes: [code] },
    })),
  );
}

async function allRawFilesExistForDay(
  bucket: R2Bucket,
  deviceId: string,
  date: string,
  budget: SubrequestBudget,
): Promise<boolean> {
  for (const code of TUYA_CODES) {
    budget.spend("r2:head");
    if (!(await bucket.head(tuyaRawKey(deviceId, date, code)))) return false;
  }
  return true;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`missing ${name}`);
  return value;
}
