import { InvalidSourceDataError } from "../errors.js";
import { SubrequestBudgetExceededError } from "./budget.js";
import { TuyaSubscriptionExpiredError } from "../tuya/errors.js";

export type JobFailureOutcome = "retry" | "abandon";

export function classifyJobFailure(error: unknown): JobFailureOutcome {
  if (
    error instanceof TuyaSubscriptionExpiredError ||
    error instanceof SubrequestBudgetExceededError ||
    error instanceof InvalidSourceDataError
  ) {
    return "abandon";
  }
  return "retry";
}
