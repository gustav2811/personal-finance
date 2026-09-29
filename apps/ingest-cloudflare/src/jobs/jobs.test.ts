import { describe, expect, it } from "vitest";
import { InvalidJobError, parseJob } from "./jobs.js";

describe("scheduled job parsing", () => {
  it("parses each job type", () => {
    expect(parseJob({ type: "dlq-report" })).toEqual({ type: "dlq-report" });
    expect(
      parseJob({
        type: "ismrt-sync",
        scheduledTime: "2026-09-29T07:00:00.000Z",
      }),
    ).toEqual({
      type: "ismrt-sync",
      scheduledTime: "2026-09-29T07:00:00.000Z",
    });
    expect(
      parseJob({
        type: "tuya-plan",
        scheduledTime: "2026-09-29T07:00:00.000Z",
      }),
    ).toEqual({
      type: "tuya-plan",
      scheduledTime: "2026-09-29T07:00:00.000Z",
    });
    expect(
      parseJob({
        type: "tuya-day",
        deviceId: "device",
        date: "2026-09-28",
        codes: ["add_ele"],
      }),
    ).toEqual({
      type: "tuya-day",
      deviceId: "device",
      date: "2026-09-28",
      codes: ["add_ele"],
    });
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "ismrt-sync", scheduledTime: "not-a-date" },
    { type: "tuya-day", deviceId: "device", date: "2026-09-28", codes: ["bad"] },
  ])("rejects invalid body %#", (body) => {
    expect(() => parseJob(body)).toThrow(InvalidJobError);
  });
});
