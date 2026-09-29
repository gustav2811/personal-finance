import { describe, expect, it } from "vitest";
import { InvalidSourceDataError } from "../errors.js";
import { SubrequestBudgetExceededError } from "./budget.js";
import { backoffDelaySeconds, classifyJobFailure } from "./policy.js";
import {
  TuyaApiError,
  TuyaRateLimitedError,
  TuyaSubscriptionExpiredError,
} from "../tuya/errors.js";

describe("backoffDelaySeconds", () => {
  it.each([
    [1, 60],
    [2, 120],
    [3, 240],
    [5, 900],
    [9, 900],
  ])("waits after attempt %i for %i seconds", (attempts, expected) => {
    expect(backoffDelaySeconds(attempts)).toBe(expected);
  });
});

describe("classifyJobFailure", () => {
  it.each([
    [new TuyaSubscriptionExpiredError("expired"), "abandon"],
    [new SubrequestBudgetExceededError("external", 45, 45, "fetch"), "abandon"],
    [new InvalidSourceDataError("malformed"), "abandon"],
    [new TuyaRateLimitedError("too frequent"), "backoff"],
    [new TuyaApiError("server failure"), "retry"],
    [new Error("network failure"), "retry"],
    ["unknown failure", "retry"],
  ])("classifies %s as %s", (error, expected) => {
    expect(classifyJobFailure(error)).toBe(expected);
  });
});
