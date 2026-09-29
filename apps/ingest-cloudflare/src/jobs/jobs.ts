import { TUYA_CODES, type TuyaCode } from "../tuya/day.js";

export type DlqReportJob = {
  type: "dlq-report";
};

export type IsmrtSyncJob = {
  type: "ismrt-sync";
  scheduledTime: string;
};

export type TuyaPlanJob = {
  type: "tuya-plan";
  scheduledTime: string;
};

export type TuyaDayJob = {
  type: "tuya-day";
  deviceId: string;
  date: string;
  codes?: TuyaCode[];
};

export type Job = DlqReportJob | IsmrtSyncJob | TuyaPlanJob | TuyaDayJob;

export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobError";
  }
}

export function parseJob(value: unknown): Job {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new InvalidJobError("job body must contain a string type");
  }

  switch (value.type) {
    case "dlq-report":
      return { type: "dlq-report" };
    case "ismrt-sync":
      return {
        type: "ismrt-sync",
        scheduledTime: requiredScheduledTime(value.scheduledTime),
      };
    case "tuya-plan":
      return {
        type: "tuya-plan",
        scheduledTime: requiredScheduledTime(value.scheduledTime),
      };
    case "tuya-day":
      return parseTuyaDay(value);
    default:
      throw new InvalidJobError(`unknown job type: ${value.type}`);
  }
}

function parseTuyaDay(value: Record<string, unknown>): TuyaDayJob {
  const deviceId = requiredString(value.deviceId, "deviceId");
  const date = requiredString(value.date, "date");
  if (!isJohannesburgDate(date)) {
    throw new InvalidJobError("date must be a valid YYYY-MM-DD date");
  }
  const codes = value.codes === undefined ? undefined : parseCodes(value.codes);
  return { type: "tuya-day", deviceId, date, ...(codes ? { codes } : {}) };
}

function parseCodes(value: unknown): TuyaCode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidJobError("tuya-day codes must be a non-empty array");
  }
  const codes = value.map((code, index) => {
    if (typeof code !== "string" || !isTuyaCode(code)) {
      throw new InvalidJobError(`tuya-day codes[${index}] is invalid`);
    }
    return code;
  });
  if (new Set(codes).size !== codes.length) {
    throw new InvalidJobError("tuya-day codes must not contain duplicates");
  }
  return codes;
}

function requiredScheduledTime(value: unknown): string {
  const scheduledTime = requiredString(value, "scheduledTime");
  if (!Number.isFinite(Date.parse(scheduledTime))) {
    throw new InvalidJobError("scheduledTime must be a valid date");
  }
  return scheduledTime;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidJobError(`${name} must be a non-empty string`);
  }
  return value;
}

function isTuyaCode(value: string): value is TuyaCode {
  return (TUYA_CODES as readonly string[]).includes(value);
}

function isJohannesburgDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
