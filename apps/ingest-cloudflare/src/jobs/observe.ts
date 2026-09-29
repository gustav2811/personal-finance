import { InvalidSourceDataError } from "../errors.js";
import { SubrequestBudgetExceededError } from "./budget.js";
import type { Job } from "./jobs.js";
import type { JobFailureOutcome } from "./policy.js";
import {
  TuyaRateLimitedError,
  TuyaSubscriptionExpiredError,
} from "../tuya/errors.js";

export type FailureJob = Job | "email-ingest";

export function buildFailureTags(
  queue: string,
  job: FailureJob,
  error: unknown,
  context: { jobId?: string; outcome?: JobFailureOutcome } = {},
): Record<string, string> {
  const tags: Record<string, string> = {
    queue,
    job_type: typeof job === "string" ? job : job.type,
    error_type: errorType(error),
  };

  if (typeof job !== "string" && job.type === "tuya-day") {
    tags.device_id = job.deviceId;
    tags.date = job.date;
  }
  if (context.jobId !== undefined) tags.job_id = context.jobId;
  if (context.outcome !== undefined) tags.outcome = context.outcome;
  return tags;
}

export function errorType(error: unknown): string {
  if (error instanceof TuyaSubscriptionExpiredError) {
    return "tuya_subscription_expired";
  }
  if (error instanceof TuyaRateLimitedError) {
    return "tuya_rate_limited";
  }
  if (error instanceof SubrequestBudgetExceededError) {
    return "subrequest_budget_exceeded";
  }
  if (error instanceof InvalidSourceDataError) {
    return "invalid_source_data";
  }
  return error instanceof Error ? error.name : "unknown";
}
