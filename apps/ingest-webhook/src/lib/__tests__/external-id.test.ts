import { describe, it, expect } from "vitest";
import { buildExternalId } from "../external-id.js";

describe("buildExternalId", () => {
  it("returns deterministic id for same inputs", () => {
    const a = buildExternalId("bank_zero", "acc1", "2026-01-15", -100.5, "REF123");
    const b = buildExternalId("bank_zero", "acc1", "2026-01-15", -100.5, "REF123");
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).toMatch(/^[a-f0-9]+$/);
  });

  it("returns different id for different amount", () => {
    const a = buildExternalId("bank_zero", "acc1", "2026-01-15", -100, "REF");
    const b = buildExternalId("bank_zero", "acc1", "2026-01-15", -101, "REF");
    expect(a).not.toBe(b);
  });

  it("returns different id for different date", () => {
    const a = buildExternalId("bank_zero", "acc1", "2026-01-15", -100, "REF");
    const b = buildExternalId("bank_zero", "acc1", "2026-01-16", -100, "REF");
    expect(a).not.toBe(b);
  });
});
