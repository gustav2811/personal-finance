import { describe, expect, it } from "vitest";
import { SubrequestBudgetExceededError } from "./budget.js";
import { buildFailureTags } from "./observe.js";
import { TuyaSubscriptionExpiredError } from "../tuya/client.js";

describe("buildFailureTags", () => {
  it("tags expired Tuya jobs with device and date", () => {
    expect(
      buildFailureTags(
        "investments-jobs",
        { type: "tuya-day", deviceId: "device", date: "2026-09-28" },
        new TuyaSubscriptionExpiredError("expired"),
      ),
    ).toEqual({
      queue: "investments-jobs",
      job_type: "tuya-day",
      error_type: "tuya_subscription_expired",
      device_id: "device",
      date: "2026-09-28",
    });
  });

  it("uses the budget error tag for budget failures", () => {
    expect(
      buildFailureTags(
        "investments-jobs",
        { type: "tuya-day", deviceId: "device", date: "2026-09-28" },
        new SubrequestBudgetExceededError(46, 45, "test"),
      ).error_type,
    ).toBe("subrequest_budget_exceeded");
  });

  it("tags email failures with the job id", () => {
    expect(
      buildFailureTags("investments-email-ingest", "email-ingest", new Error("boom"), {
        jobId: "job-1",
      }),
    ).toEqual({
      queue: "investments-email-ingest",
      job_type: "email-ingest",
      error_type: "Error",
      job_id: "job-1",
    });
  });
});
