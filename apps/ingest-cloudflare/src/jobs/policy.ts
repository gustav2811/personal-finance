import { InvalidSourceDataError } from "../errors.js";
import { SubrequestBudgetExceededError } from "./budget.js";
import {
  TuyaRateLimitedError,
  TuyaSubscriptionExpiredError,
} from "../tuya/errors.js";

export type JobFailureOutcome = "retry" | "backoff" | "abandon";

const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 900;

export function classifyJobFailure(error: unknown): JobFailureOutcome {
  if (
    error instanceof TuyaSubscriptionExpiredError ||
    error instanceof SubrequestBudgetExceededError ||
    error instanceof InvalidSourceDataError
  ) {
    return "abandon";
  }
  if (error instanceof TuyaRateLimitedError) return "backoff";
  return "retry";
}

export function backoffDelaySeconds(attempts: number): number {
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_SECONDS);
}
