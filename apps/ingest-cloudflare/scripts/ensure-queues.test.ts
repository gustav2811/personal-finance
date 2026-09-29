import { describe, expect, it } from "vitest";
import { parseQueueNames, planQueueCreates } from "./ensure-queues.mjs";

describe("ensure-queues helpers", () => {
  it("parses and deduplicates queue declarations", () => {
    expect(
      parseQueueNames(`
[[queues.producers]]
queue = "investments-email-ingest"

[[queues.consumers]]
queue = "investments-jobs"

[[queues.producers]]
queue = "investments-email-ingest"
      `),
    ).toEqual(["investments-email-ingest", "investments-jobs"]);
  });

  it("plans only missing queues while preserving wanted order", () => {
    expect(
      planQueueCreates(
        ["investments-jobs", "investments-email-ingest", "investments-jobs"],
        ["investments-email-ingest"],
      ),
    ).toEqual(["investments-jobs"]);
  });
});
