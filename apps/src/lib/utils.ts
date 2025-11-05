export function normalizeDate(value: string | number): string {
  // Always return 'YYYY-MM-DD' to match DATE column type
  if (typeof value === "number") {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) {
    return value.replace(/\//g, "-");
  }
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(value);
}

/**
 * Safely converts a UTC millisecond timestamp into 'YYYY-MM-DD'.
 * Timezone-safe for serverless environments.
 */
export function normalizeTimestampToDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

type LogContext = Record<string, unknown> | undefined;

export function logInfo(message: string, context?: LogContext): void {
  // Structured logging as JSON for downstream processing
  // Do not include secrets in context
  const payload = { level: "info", message, ...(context ?? {}) };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export function logError(message: string, context?: LogContext): void {
  const payload = { level: "error", message, ...(context ?? {}) };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(payload));
}

export function chunk<T>(array: T[], size: number): T[][] {
  if (!array.length) return [];
  const head = array.slice(0, size);
  const tail = array.slice(size);
  return [head, ...chunk(tail, size)];
}
