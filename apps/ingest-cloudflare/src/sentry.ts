import type { CloudflareOptions } from "@sentry/cloudflare";

// Both Workers handle bank statements and household data: send errors and tags only, never payloads.
export function sentryOptions(env: { SENTRY_DSN: string }): CloudflareOptions {
  if (!env.SENTRY_DSN.trim()) throw new Error("missing SENTRY_DSN");
  return {
    dsn: env.SENTRY_DSN,
    environment: "production",
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  };
}
