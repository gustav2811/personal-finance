import { describe, it, expect } from "vitest";
import { detectBank, parseDomainFromFromHeader } from "../index.js";

describe("parseDomainFromFromHeader", () => {
  it("extracts domain from display-name form (Bank Zero)", () => {
    expect(
      parseDomainFromFromHeader(
        '"bankzero.co.za" <e-services@bankzerosa.co.za>',
      ),
    ).toBe("bankzerosa.co.za");
  });

  it("handles plain address", () => {
    expect(parseDomainFromFromHeader("e-services@bankzerosa.co.za")).toBe(
      "bankzerosa.co.za",
    );
  });

  it("strips trailing junk after domain in malformed addr-spec", () => {
    expect(
      parseDomainFromFromHeader("e-services@bankzerosa.co.za>"),
    ).toBe("bankzerosa.co.za");
  });
});

describe("detectBank", () => {
  const bankZeroFrom =
    '"bankzero.co.za" <e-services@bankzerosa.co.za>';

  it("detects bank_zero from From domain with display name and Savings filename", () => {
    expect(
      detectBank(
        bankZeroFrom,
        "other",
        "Emergency Savings Savings March2026.xls",
      ),
    ).toBe("bank_zero");
  });

  it("detects bank_zero from From domain even when filename has no bank hints", () => {
    expect(detectBank(bankZeroFrom, "other", "Coffee Machine Savings March2026.xls")).toBe(
      "bank_zero",
    );
  });

  it("detects bank_zero from Transaction …xls (Bank Zero naming)", () => {
    expect(
      detectBank(
        "someone@gmail.com",
        "noreply@example.com",
        "Transaction 80204621122 March2026.xls",
      ),
    ).toBe("bank_zero");
  });

  it("still matches Transactional… filename", () => {
    expect(
      detectBank(
        "x@y.com",
        "z@z.com",
        "Transactional 80204387707 Mar 2026.xlsx",
      ),
    ).toBe("bank_zero");
  });

  it("detects via to local part statements", () => {
    expect(
      detectBank(
        "unknown@example.com",
        "statements@parse.example.org",
        "anything.xls",
      ),
    ).toBe("bank_zero");
  });

  it("returns undefined for unrelated mail", () => {
    expect(
      detectBank("a@gmail.com", "b@gmail.com", "report.pdf"),
    ).toBeUndefined();
  });
});
