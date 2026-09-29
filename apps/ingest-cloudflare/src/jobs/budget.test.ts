import { describe, expect, it, vi } from "vitest";
import {
  budgetedFetch,
  JOB_SUBREQUEST_LIMIT,
  PLATFORM_SUBREQUEST_LIMIT,
  SubrequestBudget,
  SubrequestBudgetExceededError,
} from "./budget.js";

describe("SubrequestBudget", () => {
  it("throws on the 46th spend", () => {
    const budget = new SubrequestBudget();
    for (let index = 0; index < JOB_SUBREQUEST_LIMIT; index += 1) {
      budget.spend(`request:${index}`);
    }

    expect(() => budget.spend("request:46")).toThrow(
      SubrequestBudgetExceededError,
    );
    expect(budget.used).toBe(JOB_SUBREQUEST_LIMIT);
  });

  it("lets reserve spends through after the job limit up to the platform limit", () => {
    const budget = new SubrequestBudget();
    for (let index = 0; index < JOB_SUBREQUEST_LIMIT; index += 1) {
      budget.spend(`request:${index}`);
    }
    expect(() => budget.spend("request:46")).toThrow(SubrequestBudgetExceededError);

    for (let index = JOB_SUBREQUEST_LIMIT; index < PLATFORM_SUBREQUEST_LIMIT; index += 1) {
      budget.spendReserve(`reserve:${index}`);
    }
    expect(budget.used).toBe(PLATFORM_SUBREQUEST_LIMIT);
    expect(() => budget.spendReserve("reserve:51")).toThrow(SubrequestBudgetExceededError);
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
    expect(budget.used).toBe(1);
  });
});
