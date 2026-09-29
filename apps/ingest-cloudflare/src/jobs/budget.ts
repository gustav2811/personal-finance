export const JOB_SUBREQUEST_LIMIT = 45;
// Cloudflare free plan hard limit; the gap above JOB_SUBREQUEST_LIMIT is reserved for recovery work.
export const PLATFORM_SUBREQUEST_LIMIT = 50;

export class SubrequestBudgetExceededError extends Error {
  readonly used: number;
  readonly limit: number;
  readonly label: string;

  constructor(used: number, limit: number, label: string) {
    super(`Subrequest budget exceeded at ${label}: ${used}/${limit}`);
    this.name = "SubrequestBudgetExceededError";
    this.used = used;
    this.limit = limit;
    this.label = label;
  }
}

export class SubrequestBudget {
  private count = 0;

  constructor(readonly limit = JOB_SUBREQUEST_LIMIT) {}

  get used(): number {
    return this.count;
  }

  spend(label: string): void {
    this.take(label, this.limit);
  }

  spendReserve(label: string): void {
    this.take(label, PLATFORM_SUBREQUEST_LIMIT);
  }

  private take(label: string, limit: number): void {
    if (this.count + 1 > limit) {
      throw new SubrequestBudgetExceededError(this.count + 1, limit, label);
    }
    this.count += 1;
  }
}

export function budgetedFetch(
  budget: SubrequestBudget,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(requestUrl);
    budget.spend(`${url.host}${url.pathname}`);
    return fetchImpl(input, init);
  }) as typeof fetch;
}
