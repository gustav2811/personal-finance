import { describe, expect, it } from "vitest";
import { shouldUseBankZeroStatementPipeline } from "./process-job.js";

describe("Bank Zero statement routing", () => {
  it("keeps legacy import enabled for deliveries resolved to the unverified route", () => {
    expect(shouldUseBankZeroStatementPipeline("bank_zero", { routeKey: "unverified" })).toBe(false);
    expect(shouldUseBankZeroStatementPipeline("bank_zero", undefined)).toBe(false);
  });

  it("uses durable Bank Zero parsing only for a resolved route", () => {
    expect(shouldUseBankZeroStatementPipeline("bank_zero", { routeKey: "profile-a" })).toBe(true);
    expect(shouldUseBankZeroStatementPipeline("other_bank", { routeKey: "profile-a" })).toBe(false);
  });
});
