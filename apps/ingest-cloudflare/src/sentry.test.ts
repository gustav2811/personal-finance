import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";

describe("sentryOptions", () => {
  it("rejects a missing DSN", () => {
    expect(() => sentryOptions({ SENTRY_DSN: " " })).toThrow("missing SENTRY_DSN");
  });

  it("sends no request data, payloads or traces", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://key@example.ingest.sentry.io/1" });
    expect(options.tracesSampleRate).toBe(0);
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      httpBodies: [],
      httpHeaders: false,
      urlQueryParams: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});
