import { ConsumptionRpc } from "../ismrt/supabase.js";
import {
  SubrequestBudget,
  SubrequestBudgetExceededError,
} from "../jobs/budget.js";
import {
  createTuyaDayJob,
  createTuyaPlanJob,
  type TuyaDayJob,
} from "../jobs/jobs.js";
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

export type TuyaDayMessage = TuyaDayJob;

export type TuyaEnv = {
  INGEST_BUCKET: R2Bucket;
  JOBS_QUEUE: Queue<unknown>;
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
  jobId = createTuyaPlanJob(now).jobId,
): Promise<void> {
  const deviceId = required(env.TUYA_DEVICE_ID, "TUYA_DEVICE_ID");
  const missingDates: string[] = [];
  for (const date of tuyaPlanDates(now)) {
    budget.internal("r2:head");
    if (!(await env.INGEST_BUCKET.head(tuyaSuccessKey(deviceId, date)))) {
      missingDates.push(date);
    }
  }
  for (const date of missingDates) {
    const markerKey = tuyaSuccessKey(deviceId, date);

    console.log(
      JSON.stringify({
        level: "warn",
        msg: "tuya_day_missing",
        component: "ingest-consumer",
        job_id: jobId,
        device_id: deviceId,
        date,
        marker_key: markerKey,
        subrequests_used: budget.used,
      }),
    );
  }
  if (missingDates.length > 0) {
    budget.internal("queue:sendBatch");
    await env.JOBS_QUEUE.sendBatch(
      missingDates.map((date) => ({
        body: createTuyaDayJob(deviceId, date),
      })),
    );
  }
}

export async function handleTuyaDay(
  message: TuyaDayJob,
  env: TuyaEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
  budget = new SubrequestBudget(),
): Promise<void> {
  const deviceId = required(message.deviceId, "Tuya device id");
  const date = message.date;
  const markerKey = tuyaSuccessKey(deviceId, date);
  budget.internal("r2:head");
  if (await env.INGEST_BUCKET.head(markerKey)) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_already_ingested",
        component: "ingest-consumer",
        job_id: message.jobId,
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
  const codesToFetch = requestedCodes;
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
        job_id: message.jobId,
        device_id: deviceId,
        date,
        events: eventCounts,
        subrequests_used: budget.used,
      }),
    );
    return;
  }

  budget.internal("r2:head");
  if (await env.INGEST_BUCKET.head(markerKey)) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tuya_day_already_ingested",
        component: "ingest-consumer",
      job_id: message.jobId,
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

  budget.internal("r2:put");
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
      job_id: message.jobId,
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
  budget.internal("queue:sendBatch");
  await env.JOBS_QUEUE.sendBatch(
    TUYA_CODES.map((code) => ({
      body: createTuyaDayJob(deviceId, date, [code]),
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
    budget.internal("r2:head");
    if (!(await bucket.head(tuyaRawKey(deviceId, date, code)))) return false;
  }
  return true;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`missing ${name}`);
  return value;
}
