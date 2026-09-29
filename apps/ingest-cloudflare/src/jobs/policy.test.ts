import { describe, expect, it } from "vitest";
import { InvalidSourceDataError } from "../errors.js";
import { SubrequestBudgetExceededError } from "./budget.js";
import { classifyJobFailure } from "./policy.js";
import {
  TuyaApiError,
  TuyaSubscriptionExpiredError,
} from "../tuya/errors.js";

describe("classifyJobFailure", () => {
  it.each([
    [new TuyaSubscriptionExpiredError("expired"), "abandon"],
    [new SubrequestBudgetExceededError("external", 45, 45, "fetch"), "abandon"],
    [new InvalidSourceDataError("malformed"), "abandon"],
    [new TuyaApiError("server failure"), "retry"],
    [new Error("network failure"), "retry"],
    ["unknown failure", "retry"],
  ])("classifies %s as %s", (error, expected) => {
    expect(classifyJobFailure(error)).toBe(expected);
  });
});
