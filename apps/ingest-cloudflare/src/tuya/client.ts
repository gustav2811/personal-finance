import { InvalidSourceDataError } from "../errors.js";
import {
  TuyaApiError,
  TuyaRateLimitedError,
  TuyaSubscriptionExpiredError,
} from "./errors.js";

export { TuyaApiError, TuyaSubscriptionExpiredError } from "./errors.js";

const TUYA_BASE_URL = "https://openapi.tuyaeu.com";
const REPORT_LOG_PAGE_SIZE = 100;

export type TuyaLogEntry = {
  code: string;
  event_time: number;
  value: string;
};

type TuyaClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type TuyaEnvelope = {
  success: boolean;
  result?: unknown;
  code?: unknown;
  msg?: unknown;
  tid?: unknown;
};

export class TuyaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private accessToken: string | null = null;

  constructor(
    private readonly accessId: string,
    private readonly accessSecret: string,
    options: TuyaClientOptions = {},
  ) {
    if (!accessId.trim()) throw new Error("missing TUYA_ACCESS_ID");
    if (!accessSecret.trim()) throw new Error("missing TUYA_ACCESS_SECRET");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async authenticate(): Promise<string> {
    const result = await this.request("/v1.0/token?grant_type=1");
    if (!isRecord(result) || typeof result.access_token !== "string" || !result.access_token) {
      throw new InvalidSourceDataError(
        "Tuya token response is missing result.access_token",
      );
    }
    this.accessToken = result.access_token;
    return result.access_token;
  }

  async reportLogs(
    deviceId: string,
    code: string,
    startTime: number,
    endTime: number,
  ): Promise<TuyaLogEntry[]> {
    if (!deviceId.trim()) {
      throw new InvalidSourceDataError("missing Tuya device id");
    }
    if (!code.trim()) {
      throw new InvalidSourceDataError("missing Tuya report code");
    }
    if (!Number.isInteger(startTime) || !Number.isInteger(endTime) || startTime >= endTime) {
      throw new InvalidSourceDataError(
        `invalid Tuya report window: ${startTime}..${endTime}`,
      );
    }

    if (!this.accessToken) await this.authenticate();

    const logs: TuyaLogEntry[] = [];
    const seenRowKeys = new Set<string>();
    let lastRowKey: string | undefined;

    for (;;) {
      const params = new URLSearchParams();
      params.set("codes", code);
      params.set("end_time", String(endTime));
      if (lastRowKey !== undefined) params.set("last_row_key", lastRowKey);
      params.set("size", String(REPORT_LOG_PAGE_SIZE));
      params.set("start_time", String(startTime));
      const path = `/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/report-logs?${params.toString()}`;
      const result = await this.request(path);
      const page = parseReportLogsResult(result, code);
      logs.push(...page.logs);

      if (!page.hasMore) return logs;
      if (!page.lastRowKey) {
        throw new InvalidSourceDataError(
          `Tuya report logs page for ${code} has_more without last_row_key`,
        );
      }
      if (seenRowKeys.has(page.lastRowKey)) {
        throw new InvalidSourceDataError(
          `Tuya report logs pagination repeated last_row_key for ${code}`,
        );
      }
      seenRowKeys.add(page.lastRowKey);
      lastRowKey = page.lastRowKey;
    }
  }

  private async request(pathWithQuery: string): Promise<unknown> {
    const timestamp = String(this.now());
    const accessToken = this.accessToken ?? "";
    const signature = await createTuyaSignature({
      accessId: this.accessId,
      accessSecret: this.accessSecret,
      accessToken,
      timestamp,
      method: "GET",
      body: "",
      pathWithQuery,
    });
    const response = await this.fetchImpl(`${TUYA_BASE_URL}${pathWithQuery}`, {
      method: "GET",
      headers: {
        client_id: this.accessId,
        sign: signature,
        t: timestamp,
        sign_method: "HMAC-SHA256",
        ...(accessToken ? { access_token: accessToken } : {}),
      },
    });
    const text = await response.text();
    if (response.status >= 500) {
      throw new TuyaApiError(`Tuya API request failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new InvalidSourceDataError(
        `Tuya returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!isTuyaEnvelope(parsed)) {
      throw new InvalidSourceDataError(
        `Tuya returned an invalid response envelope (HTTP ${response.status})`,
      );
    }
    if (!response.ok || !parsed.success) {
      const code = stringValue(parsed.code);
      const msg = stringValue(parsed.msg) ?? "unknown Tuya API error";
      const tid = stringValue(parsed.tid);
      const details = { code, tid, status: response.status };
      const context = `code=${code ?? "unknown"} msg=${msg} tid=${tid ?? "unknown"}`;
      if (code === "28841002") {
        throw new TuyaSubscriptionExpiredError(
          `Tuya API subscription expired (${context})`,
          details,
        );
      }
      if (code === "40000309") {
        throw new TuyaRateLimitedError(`Tuya API rate limited (${context})`, details);
      }
      throw new TuyaApiError(`Tuya API request failed (${context})`, details);
    }
    return parsed.result;
  }
}

export async function createTuyaSignature(input: {
  accessId: string;
  accessSecret: string;
  accessToken: string;
  timestamp: string;
  method: string;
  body: string;
  pathWithQuery: string;
}): Promise<string> {
  const stringToSign = await buildTuyaStringToSign(
    input.method,
    input.body,
    input.pathWithQuery,
  );
  const signingInput =
    input.accessId + input.accessToken + input.timestamp + stringToSign;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.accessSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return bytesToHex(new Uint8Array(signature)).toUpperCase();
}

export async function buildTuyaStringToSign(
  method: string,
  body: string,
  pathWithQuery: string,
): Promise<string> {
  return [method, await sha256Hex(body), "", pathWithQuery].join("\n");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function parseReportLogsResult(value: unknown, requestedCode: string): {
  hasMore: boolean;
  lastRowKey: string | undefined;
  logs: TuyaLogEntry[];
} {
  if (!isRecord(value) || typeof value.has_more !== "boolean" || !Array.isArray(value.logs)) {
    throw new InvalidSourceDataError(
      "Tuya report logs response is missing result fields",
    );
  }
  let lastRowKey: string | undefined;
  if (value.last_row_key !== undefined && value.last_row_key !== null) {
    const parsedRowKey = stringValue(value.last_row_key);
    if (!parsedRowKey) {
      throw new InvalidSourceDataError(
        "Tuya report logs response has an invalid last_row_key",
      );
    }
    lastRowKey = parsedRowKey;
  }

  return {
    hasMore: value.has_more,
    lastRowKey,
    logs: value.logs.map((entry, index) => parseLogEntry(entry, requestedCode, index)),
  };
}

function parseLogEntry(value: unknown, requestedCode: string, index: number): TuyaLogEntry {
  if (!isRecord(value)) {
    throw new InvalidSourceDataError(
      `Tuya report log ${requestedCode}[${index}] is not an object`,
    );
  }
  if (
    typeof value.code !== "string" ||
    typeof value.event_time !== "number" ||
    !Number.isFinite(value.event_time) ||
    typeof value.value !== "string"
  ) {
    throw new InvalidSourceDataError(
      `Tuya report log ${requestedCode}[${index}] has invalid fields`,
    );
  }
  return {
    code: value.code,
    event_time: value.event_time,
    value: value.value,
  };
}

function isTuyaEnvelope(value: unknown): value is TuyaEnvelope {
  return isRecord(value) && typeof value.success === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
