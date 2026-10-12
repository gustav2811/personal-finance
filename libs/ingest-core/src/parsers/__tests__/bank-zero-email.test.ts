import { describe, expect, it } from "vitest";
import { parseBankZeroEmail } from "../bank-zero-email.js";

describe("Bank Zero email parser", () => {
  it("parses a received payment from the real HTML template shape", () => {
    const parsed = parseBankZeroEmail({
      subject: "Gustav: Money Received R3 340.00 from Alex Example with reference 'Invoice 17' on 12 Oct-26 Mon 08h54, balance R3 547 (Transactional)",
      html: "<p>Money Received <span>R3 340.00</span> from <span>Alex Example</span> with reference &#39;<span>Invoice 17</span>&#39; on <span>12 Oct-26 Mon 08h54</span>, balance <span>R3 547</span> (<span>Transactional</span>)</p>",
    });

    expect(parsed).toMatchObject({
      messageClass: "money_received",
      outcome: "movement_candidate",
      direction: "credit",
      amountMinor: 334000,
      counterparty: "Alex Example",
      reference: "Invoice 17",
      accountAlias: "Transactional",
      eventAt: "2026-10-12T08:54:00+02:00",
      balanceMinor: 354700,
      sourceFields: { amountMinor: "body", counterparty: "body" },
    });
  });

  it("parses immediate and ordinary payments without confusing their methods", () => {
    const ordinary = parseBankZeroEmail({
      subject: "Paid R400.00 to Sample Merchant with reference 'Household' on 12 Oct-26 Mon 11h44 (Transactional)",
    });
    const immediate = parseBankZeroEmail({
      subject: "Pay Immediately R400.00 to Sample Merchant with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
    });
    expect(ordinary).toMatchObject({ messageClass: "paid", direction: "debit", amountMinor: 40000, paymentMethod: "ordinary_payment" });
    expect(immediate).toMatchObject({ messageClass: "paid", direction: "debit", amountMinor: 40000, paymentMethod: "immediate_payment" });
  });

  it("uses the subject when a refund body contains only a template filename", () => {
    const parsed = parseBankZeroEmail({
      subject: "Card Refund R2.67 at Sample Taxi, Thailand on 28 Nov-25 Fri 17h22, balance R569 (Transactional)",
      html: "<html><body>global-card-refund-email.html</body></html>",
    });
    expect(parsed).toMatchObject({
      messageClass: "card_refund", direction: "credit", amountMinor: 267,
      eventAt: "2025-11-28T17:22:00+02:00", sourceFields: { amountMinor: "subject" },
    });
  });

  it("imports only a charged fee, never the attempted amount", () => {
    const charged = parseBankZeroEmail({
      subject: "Card Fee: Insufficient Funds R2.50 for R15.67 @ Sample Taxi, Indonesia on 02 Dec-25 Tue 07h56, balance R8 (Transactional)",
    });
    const zero = parseBankZeroEmail({
      subject: "Card Fee: Insufficient Funds R0.00 for R111.78 @ Sample Bus, Singapore on 24 Nov-25 Mon 10h53, balance R0 (Transactional)",
    });
    expect(charged).toMatchObject({ messageClass: "fee", outcome: "movement_candidate", direction: "debit", amountMinor: 250, attemptedAmountMinor: 1567 });
    expect(zero).toMatchObject({ messageClass: "fee", outcome: "no_movement", attemptedAmountMinor: 11178 });
    expect(zero.amountMinor).toBeUndefined();
  });

  it("records returns as separate incoming movements", () => {
    const parsed = parseBankZeroEmail({
      subject: "Pay Immediately Returned R8 100.00 from Sample Bank with reference 'Invoice 10973 Balance' on 13 Sep-24 Fri 15h31, balance R8 116 (Transactional)",
    });
    expect(parsed).toMatchObject({
      messageClass: "payment_returned", direction: "credit", amountMinor: 810000,
      paymentMethod: "immediate_payment", reference: "Invoice 10973 Balance",
    });
  });

  it("holds material subject/body conflicts", () => {
    const parsed = parseBankZeroEmail({
      subject: "Paid R400.00 to Sample Merchant with reference 'Invoice A' on 12 Oct-26 Mon 11h44 (Transactional)",
      text: "Paid R500.00 to Sample Merchant with reference 'Invoice A' on 12 Oct-26 Mon 11h44 (Transactional)",
    });
    expect(parsed).toMatchObject({ messageClass: "unknown", outcome: "review", conflict: "amountMinor differs between subject and body" });
  });

  it("recognizes proofs, statements, status, declines, and unknowns without making transactions", () => {
    expect(parseBankZeroEmail({ subject: "Bank Zero: Payment of R400.00 from Example to Merchant", attachments: [{ filename: "ProofOfPayment.pdf", mimetype: "application/pdf" }] }).messageClass).toBe("proof_of_payment");
    expect(parseBankZeroEmail({ subject: "Bank Statement for Transactional October2026", attachments: [{ filename: "Transactional October2026.xls", mimetype: "application/vnd.ms-excel" }] }).messageClass).toBe("statement");
    expect(parseBankZeroEmail({ subject: "Bank Zero: Banking status as at 11 Jan-26 Sun 06h00" }).outcome).toBe("review");
    expect(parseBankZeroEmail({ subject: "Card Online Timeout Tried R72.30 at Sample Taxi on 01 Dec-25 Mon 04h19" }).outcome).toBe("no_movement");
    expect(parseBankZeroEmail({ subject: "A newly introduced Bank Zero template" }).outcome).toBe("review");
  });

  it("extracts an exact timestamped account balance without creating a movement", () => {
    const parsed = parseBankZeroEmail({
      subject: "Bank Zero Banking status as at 11 Jan-26 Sun 06h00 balance R1,234.56 (Transactional)",
    });
    expect(parsed).toMatchObject({
      messageClass: "banking_status", outcome: "balance_snapshot", accountAlias: "Transactional",
      balanceMinor: 123456, eventAt: "2026-01-11T06:00:00+02:00",
    });
  });
});
