const SUBSCRIPTION_EXPIRED_CODE = "28841002";
const RATE_LIMITED_CODE = "40000309";

export class TuyaApiError extends Error {
  readonly code: string | null;
  readonly tid: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    details: { code?: string | null; tid?: string | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = "TuyaApiError";
    this.code = details.code ?? null;
    this.tid = details.tid ?? null;
    this.status = details.status ?? null;
  }
}

export class TuyaSubscriptionExpiredError extends TuyaApiError {
  constructor(
    message: string,
    details: { tid?: string | null; status?: number | null } = {},
  ) {
    super(message, { ...details, code: SUBSCRIPTION_EXPIRED_CODE });
    this.name = "TuyaSubscriptionExpiredError";
  }
}

export class TuyaRateLimitedError extends TuyaApiError {
  constructor(
    message: string,
    details: { tid?: string | null; status?: number | null } = {},
  ) {
    super(message, { ...details, code: RATE_LIMITED_CODE });
    this.name = "TuyaRateLimitedError";
  }
}
