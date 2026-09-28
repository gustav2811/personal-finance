export const HOUSEHOLD_TIMEZONE = "Africa/Johannesburg";
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type IncurredDateRule = "daily_close" | "named_month" | "event_timestamp";

export function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid timestamp: ${value}`);
  }
  return parsed.toISOString();
}

export function closedWindow(now: Date, lookbackDays: number): { start: string; end: string } {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 400) {
    throw new Error(`ISMRT_LOOKBACK_DAYS must be an integer from 1 to 400, got ${lookbackDays}`);
  }
  const sast = new Date(now.getTime() + SAST_OFFSET_MS);
  const startOfTodaySast = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate());
  const end = new Date(startOfTodaySast - SAST_OFFSET_MS);
  const start = new Date(end.getTime() - lookbackDays * DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function isDailyClose(timestamp: string): boolean {
  const date = new Date(canonicalTimestamp(timestamp));
  return (
    date.getUTCHours() === 22 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

export function johannesburgParts(timestamp: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(canonicalTimestamp(timestamp)));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  if (!year || !month || !day) {
    throw new Error(`could not read Johannesburg date from ${timestamp}`);
  }
  return { year, month, day };
}

export function monthStartSast(year: number, month: number): string {
  if (month < 1 || month > 12) {
    throw new Error(`invalid month ${month}`);
  }
  return new Date(Date.UTC(year, month - 1, 1) - SAST_OFFSET_MS).toISOString();
}

export function incurredInstant(input: {
  postedAt: string;
  utility: "electricity" | "water" | "wallet";
  description: string | null;
}): { occurredAt: string; rule: IncurredDateRule } {
  const postedAt = canonicalTimestamp(input.postedAt);
  if (input.utility === "water") {
    return { occurredAt: waterIncurredAt(postedAt, input.description), rule: "named_month" };
  }
  // 22:00Z is midnight SAST on the next calendar day: the close of the usage day.
  if (isDailyClose(postedAt)) {
    return { occurredAt: new Date(new Date(postedAt).getTime() - DAY_MS).toISOString(), rule: "daily_close" };
  }
  return { occurredAt: postedAt, rule: "event_timestamp" };
}

function waterIncurredAt(postedAt: string, description: string | null): string {
  const match = description?.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+monthly\b/,
  );
  if (!match) {
    throw new Error(`water charge is missing a usage month: ${description ?? ""}`);
  }
  const namedMonth = MONTHS.indexOf(match[1] as (typeof MONTHS)[number]) + 1;
  const posted = johannesburgParts(postedAt);
  const year = namedMonth > posted.month ? posted.year - 1 : posted.year;
  return monthStartSast(year, namedMonth);
}

export function moneyKey(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`invalid money amount: ${amount}`);
  }
  return amount.toFixed(4);
}

export function ledgerSourceRecordId(input: {
  utility: string;
  entryType: string;
  postedAt: string;
  direction: string;
  amount: number;
  occurrence: number;
}): string {
  return [
    "ismrt",
    "ledger",
    input.utility,
    input.entryType,
    canonicalTimestamp(input.postedAt),
    input.direction,
    moneyKey(input.amount),
    String(input.occurrence),
  ].join(":");
}
