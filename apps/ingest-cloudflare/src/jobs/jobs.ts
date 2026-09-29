import { TUYA_CODES, type TuyaCode } from "../tuya/day.js";

export type DlqReportJob = {
  v: 1;
  jobId: string;
  type: "dlq-report";
};

export type IsmrtSyncJob = {
  v: 1;
  jobId: string;
  type: "ismrt-sync";
  scheduledTime: string;
};

export type TuyaPlanJob = {
  v: 1;
  jobId: string;
  type: "tuya-plan";
  scheduledTime: string;
};

export type TuyaDayJob = {
  v: 1;
  jobId: string;
  type: "tuya-day";
  deviceId: string;
  date: string;
  codes?: TuyaCode[];
};

export type JobV1 = DlqReportJob | IsmrtSyncJob | TuyaPlanJob | TuyaDayJob;
export type Job = JobV1;

export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobError";
  }
}

export type ParseJobResult =
  | { ok: true; job: JobV1 }
  | { ok: false; reason: "unsupported_version"; v: unknown }
  | { ok: false; reason: "invalid" };

export function createDlqReportJob(
  scheduledTime: Date | string,
): DlqReportJob {
  const date = utcDate(scheduledTime);
  return {
    v: 1,
    jobId: `dlq-report:${date}`,
    type: "dlq-report",
  };
}

export function createIsmrtSyncJob(
  scheduledTime: Date | string,
): IsmrtSyncJob {
  const scheduledTimeValue = scheduledTimeString(scheduledTime);
  return {
    v: 1,
    jobId: `ismrt-sync:${utcDate(scheduledTimeValue)}`,
    type: "ismrt-sync",
    scheduledTime: scheduledTimeValue,
  };
}

export function createTuyaPlanJob(
  scheduledTime: Date | string,
): TuyaPlanJob {
  const scheduledTimeValue = scheduledTimeString(scheduledTime);
  return {
    v: 1,
    jobId: `tuya-plan:${utcDate(scheduledTimeValue)}`,
    type: "tuya-plan",
    scheduledTime: scheduledTimeValue,
  };
}

export function createTuyaDayJob(
  deviceId: string,
  date: string,
  codes?: readonly TuyaCode[],
): TuyaDayJob {
  const normalizedDeviceId = requiredStringValue(deviceId, "deviceId");
  const normalizedDate = requiredDate(date);
  const normalizedCodes = codes === undefined ? undefined : requiredCodes(codes);
  const suffix =
    normalizedCodes === undefined ? "" : `:${normalizedCodes.join("+")}`;
  return {
    v: 1,
    jobId: `tuya-day:${normalizedDeviceId}:${normalizedDate}${suffix}`,
    type: "tuya-day",
    deviceId: normalizedDeviceId,
    date: normalizedDate,
    ...(normalizedCodes === undefined ? {} : { codes: normalizedCodes }),
  };
}

export function parseJob(value: unknown): ParseJobResult {
  if (!isRecord(value)) return { ok: false, reason: "invalid" };
  if (value.v === undefined) {
    try {
      // Delete after the currently deployed producer has drained its 24h transition window.
      return { ok: true, job: upgradeLegacyJob(value) };
    } catch {
      return { ok: false, reason: "invalid" };
    }
  }
  if (value.v !== 1) {
    return { ok: false, reason: "unsupported_version", v: value.v };
  }
  try {
    return { ok: true, job: parseV1Job(value) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function upgradeLegacyJob(value: Record<string, unknown>): JobV1 {
  const type = requiredString(value.type, "type");
  switch (type) {
    case "dlq-report":
      return createDlqReportJob(
        value.scheduledTime === undefined
          ? new Date()
          : requiredScheduledTime(value.scheduledTime),
      );
    case "ismrt-sync":
      return createIsmrtSyncJob(requiredScheduledTime(value.scheduledTime));
    case "tuya-plan":
      return createTuyaPlanJob(requiredScheduledTime(value.scheduledTime));
    case "tuya-day":
      return createTuyaDayJob(
        requiredString(value.deviceId, "deviceId"),
        requiredString(value.date, "date"),
        value.codes === undefined ? undefined : parseCodes(value.codes),
      );
    default:
      throw new InvalidJobError(`unknown job type: ${type}`);
  }
}

function parseV1Job(value: Record<string, unknown>): JobV1 {
  const type = requiredString(value.type, "type");
  const jobId = requiredString(value.jobId, "jobId");
  switch (type) {
    case "dlq-report": {
      const date = jobId.slice("dlq-report:".length);
      if (
        !jobId.startsWith("dlq-report:") ||
        !isJohannesburgDate(date) &&
        !isUtcDate(date)
      ) {
        throw new InvalidJobError("dlq-report jobId is invalid");
      }
      const job = createDlqReportJob(`${date}T00:00:00.000Z`);
      if (job.jobId !== jobId) throw new InvalidJobError("jobId is not deterministic");
      return job;
    }
    case "ismrt-sync": {
      const job = createIsmrtSyncJob(requiredScheduledTime(value.scheduledTime));
      if (job.jobId !== jobId) throw new InvalidJobError("jobId is not deterministic");
      return job;
    }
    case "tuya-plan": {
      const job = createTuyaPlanJob(requiredScheduledTime(value.scheduledTime));
      if (job.jobId !== jobId) throw new InvalidJobError("jobId is not deterministic");
      return job;
    }
    case "tuya-day": {
      const job = createTuyaDayJob(
        requiredString(value.deviceId, "deviceId"),
        requiredString(value.date, "date"),
        value.codes === undefined ? undefined : parseCodes(value.codes),
      );
      if (job.jobId !== jobId) throw new InvalidJobError("jobId is not deterministic");
      return job;
    }
    default:
      throw new InvalidJobError(`unknown job type: ${type}`);
  }
}

function parseCodes(value: unknown): TuyaCode[] {
  if (!Array.isArray(value)) {
    throw new InvalidJobError("tuya-day codes must be a non-empty array");
  }
  return requiredCodes(value.map((code, index) => {
    if (typeof code !== "string" || !isTuyaCode(code)) {
      throw new InvalidJobError(`tuya-day codes[${index}] is invalid`);
    }
    return code;
  }));
}

function requiredCodes(codes: readonly TuyaCode[]): TuyaCode[] {
  if (codes.length === 0) {
    throw new InvalidJobError("tuya-day codes must be a non-empty array");
  }
  const normalized = [...codes];
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidJobError("tuya-day codes must not contain duplicates");
  }
  return normalized;
}

function isTuyaCode(value: string): value is TuyaCode {
  return (TUYA_CODES as readonly string[]).includes(value);
}

function requiredScheduledTime(value: unknown): string {
  return scheduledTimeString(requiredString(value, "scheduledTime"));
}

function scheduledTimeString(value: Date | string): string {
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) {
    throw new InvalidJobError("scheduledTime must be a valid date");
  }
  return candidate;
}

function utcDate(value: Date | string): string {
  return new Date(scheduledTimeString(value)).toISOString().slice(0, 10);
}

function requiredDate(value: string): string {
  const normalized = requiredStringValue(value, "date");
  if (!isJohannesburgDate(normalized)) {
    throw new InvalidJobError("date must be a valid YYYY-MM-DD date");
  }
  return normalized;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new InvalidJobError(`${name} must be a non-empty string`);
  }
  return requiredStringValue(value, name);
}

function requiredStringValue(value: string, name: string): string {
  if (!value.trim()) {
    throw new InvalidJobError(`${name} must be a non-empty string`);
  }
  return value;
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isJohannesburgDate(value: string): boolean {
  if (!isUtcDate(value)) return false;
  return value.length === 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
