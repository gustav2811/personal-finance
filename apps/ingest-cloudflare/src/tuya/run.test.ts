import { describe, expect, it } from "vitest";
import {
  SubrequestBudget,
  SubrequestBudgetExceededError,
} from "../jobs/budget.js";
import { TUYA_CODES, tuyaRawKey, tuyaSuccessKey } from "./day.js";
import { handleTuyaDay, planTuyaDays, type TuyaEnv } from "./run.js";

type StoredObject = {
  body: ArrayBuffer;
};

type TestBucket = R2Bucket & {
  keys: () => string[];
};

function createR2(
  initial: Record<string, StoredObject> = {},
): TestBucket {
  const objects = new Map(Object.entries(initial));
  return {
    head: async (key) => {
      const object = objects.get(key);
      return object
        ? ({ key } as unknown as R2Object)
        : null;
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        key,
        body: new Response(object.body).body,
      } as unknown as R2ObjectBody;
    },
    put: async (key, value) => {
      const body =
        value instanceof ArrayBuffer
          ? value
          : ArrayBuffer.isView(value)
            ? value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
              )
            : await new Response(value).arrayBuffer();
      objects.set(key, { body });
      return { key } as unknown as R2Object;
    },
    list: async () => ({
      objects: [...objects.keys()].map((key) => ({ key }) as unknown as R2Object),
      truncated: false,
      delimitedPrefixes: [],
    }),
    keys: () => [...objects.keys()],
  } as unknown as TestBucket;
}

function queue() {
  const batches: unknown[][] = [];
  return {
    batches,
    sendBatch: async (messages: unknown[]) => {
      batches.push(messages);
    },
  };
}

function env(
  bucket: R2Bucket,
  jobsQueue: ReturnType<typeof queue>,
): TuyaEnv {
  return {
    INGEST_BUCKET: bucket,
    JOBS_QUEUE: jobsQueue as unknown as Queue<never>,
    TUYA_DEVICE_ID: "bf425b172390340134huph",
    TUYA_ACCESS_ID: "client-id",
    TUYA_ACCESS_SECRET: "secret",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_KEY: "service-key",
  } as TuyaEnv;
}

function tuyaFetch(rpcCalls: string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/v1.0/token")) {
      return Response.json({ success: true, result: { access_token: "token" } });
    }
    if (url.includes("/report-logs")) {
      return Response.json({
        success: true,
        result: {
          has_more: false,
          logs: [{ code: "add_ele", event_time: 1, value: "100" }],
        },
      });
    }
    if (url.includes("/rpc/")) rpcCalls.push(url);
    return Response.json({});
  };
}

describe("Tuya planning", () => {
  it("sends one batch containing only missing days", async () => {
    const jobsQueue = queue();
    const deviceId = "bf425b172390340134huph";
    const bucket = createR2({
      [`tuya/${deviceId}/date=2026-09-28/_SUCCESS`]: { body: new ArrayBuffer(0) },
      [`tuya/${deviceId}/date=2026-09-26/_SUCCESS`]: { body: new ArrayBuffer(0) },
    });
    await planTuyaDays(
      env(bucket, jobsQueue),
      new Date("2026-09-29T07:00:00.000Z"),
      new SubrequestBudget(),
    );
    expect(jobsQueue.batches).toHaveLength(1);
    expect(jobsQueue.batches[0]).toEqual(
      [
        "2026-09-27",
        "2026-09-25",
        "2026-09-24",
        "2026-09-23",
      ].map((date) => ({
        body: { type: "tuya-day", deviceId, date },
      })),
    );
  });

  it("does not send a batch when all planned days exist", async () => {
    const jobsQueue = queue();
    const deviceId = "bf425b172390340134huph";
    const bucket = createR2(
      ["2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"]
        .map((date) => [
          `tuya/${deviceId}/date=${date}/_SUCCESS`,
          { body: new ArrayBuffer(0) },
        ])
        .reduce<Record<string, StoredObject>>(
          (all, [key, value]) => ({ ...all, [key]: value }),
          {},
        ),
    );
    await planTuyaDays(
      env(bucket, jobsQueue),
      new Date("2026-09-29T07:00:00.000Z"),
      new SubrequestBudget(),
    );
    expect(jobsQueue.batches).toHaveLength(0);
  });

  it("splits a fetch budget failure into one job per code", async () => {
    const jobsQueue = queue();
    const bucket = createR2();
    const fetchImpl: typeof fetch = async () => {
      throw new SubrequestBudgetExceededError(1, 45, "test:fetch");
    };
    await handleTuyaDay(
      {
        type: "tuya-day",
        deviceId: "bf425b172390340134huph",
        date: "2026-09-28",
      },
      env(bucket, jobsQueue),
      fetchImpl,
      new Date("2026-09-29T07:00:00.000Z"),
      new SubrequestBudget(),
    );
    expect(jobsQueue.batches).toEqual([
      TUYA_CODES.map((code) => ({
        body: {
          type: "tuya-day",
          deviceId: "bf425b172390340134huph",
          date: "2026-09-28",
          codes: [code],
        },
      })),
    ]);
  });
});

describe("Tuya split jobs", () => {
  it("writes one code and the last code completes the day", async () => {
    const jobsQueue = queue();
    const bucket = createR2();
    const rpcCalls: string[] = [];
    const tuyaEnv = env(bucket, jobsQueue);
    const now = new Date("2026-09-29T07:00:00.000Z");
    for (const [index, code] of TUYA_CODES.entries()) {
      await handleTuyaDay(
        {
          type: "tuya-day",
          deviceId: tuyaEnv.TUYA_DEVICE_ID,
          date: "2026-09-28",
          codes: [code],
        },
        tuyaEnv,
        tuyaFetch(rpcCalls),
        now,
        new SubrequestBudget(),
      );
      const rawKeys = bucket
        .keys()
        .filter((key) => key.endsWith(".ndjson.gz"));
      expect(rawKeys).toEqual(
        TUYA_CODES.slice(0, index + 1).map((writtenCode) =>
          tuyaRawKey(tuyaEnv.TUYA_DEVICE_ID, "2026-09-28", writtenCode),
        ),
      );
    }
    const rawKeys = TUYA_CODES.map((code) =>
      tuyaRawKey(tuyaEnv.TUYA_DEVICE_ID, "2026-09-28", code),
    );
    expect(rawKeys.every((key) => bucket.keys().includes(key))).toBe(true);
    expect(bucket.keys()).toContain(
      tuyaSuccessKey(tuyaEnv.TUYA_DEVICE_ID, "2026-09-28"),
    );
    expect(rpcCalls).toHaveLength(1);
  });
});
