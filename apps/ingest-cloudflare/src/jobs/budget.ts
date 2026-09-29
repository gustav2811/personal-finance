export const EXTERNAL_SUBREQUEST_LIMIT = 45;
export const INTERNAL_SUBREQUEST_LIMIT = 900;

export type SubrequestPool = "external" | "internal";
export type SubrequestUsage = {
  external: number;
  internal: number;
};

export class SubrequestBudgetExceededError extends Error {
  readonly pool: SubrequestPool;
  readonly used: number;
  readonly limit: number;
  readonly label: string;

  constructor(
    pool: SubrequestPool,
    used: number,
    limit: number,
    label: string,
  ) {
    super(`Subrequest ${pool} budget exceeded at ${label}: ${used}/${limit}`);
    this.name = "SubrequestBudgetExceededError";
    this.pool = pool;
    this.used = used;
    this.limit = limit;
    this.label = label;
  }
}

export class SubrequestBudget {
  private readonly counts: SubrequestUsage = { external: 0, internal: 0 };

  get used(): SubrequestUsage {
    return { ...this.counts };
  }

  external(label: string): void {
    this.take("external", label, EXTERNAL_SUBREQUEST_LIMIT);
  }

  internal(label: string): void {
    this.take("internal", label, INTERNAL_SUBREQUEST_LIMIT);
  }

  private take(pool: SubrequestPool, label: string, limit: number): void {
    const used = this.counts[pool];
    if (used >= limit) {
      throw new SubrequestBudgetExceededError(pool, used, limit, label);
    }
    this.counts[pool] += 1;
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
    budget.external(`${url.host}${url.pathname}`);
    return fetchImpl(input, init);
  }) as typeof fetch;
}
