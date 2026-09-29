import { describe, expect, it, vi } from "vitest";
import {
  budgetedFetch,
  EXTERNAL_SUBREQUEST_LIMIT,
  INTERNAL_SUBREQUEST_LIMIT,
  SubrequestBudget,
  SubrequestBudgetExceededError,
} from "./budget.js";

describe("SubrequestBudget", () => {
  it("refuses the 46th external spend without counting it", () => {
    const budget = new SubrequestBudget();
    for (let index = 0; index < EXTERNAL_SUBREQUEST_LIMIT; index += 1) {
      budget.external(`request:${index}`);
    }

    try {
      budget.external("request:46");
      throw new Error("expected budget to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SubrequestBudgetExceededError);
      expect(error).toMatchObject({
        pool: "external",
        used: EXTERNAL_SUBREQUEST_LIMIT,
        limit: EXTERNAL_SUBREQUEST_LIMIT,
        label: "request:46",
      });
    }
    expect(budget.used).toEqual({ external: EXTERNAL_SUBREQUEST_LIMIT, internal: 0 });
  });

  it("keeps internal and external pools independent", () => {
    const budget = new SubrequestBudget();
    for (let index = 0; index < INTERNAL_SUBREQUEST_LIMIT; index += 1) {
      budget.internal(`internal:${index}`);
    }
    budget.external("external:0");
    expect(budget.used).toEqual({ external: 1, internal: INTERNAL_SUBREQUEST_LIMIT });
    expect(() => budget.internal("internal:overflow")).toThrow(
      SubrequestBudgetExceededError,
    );
  });

  it("counts budgeted fetches by host and path", async () => {
    const budget = new SubrequestBudget();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("ok"),
    );
    await budgetedFetch(budget, fetchImpl)(
      "https://api.example.test/v1/items?id=1",
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(budget.used).toEqual({ external: 1, internal: 0 });
  });
});
