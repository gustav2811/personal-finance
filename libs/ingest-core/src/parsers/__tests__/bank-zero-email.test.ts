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

  it.each([
    { text: "Pay Immediately R400.00 to with reference 'Household' on 12 Oct-26 Mon 11h48, balance R201 (Transactional)." },
    { html: "<p>Pay Immediately <span>R400.00</span> to <span></span> with reference &#39;<span>Household</span>&#39; on <span>12 Oct-26 Mon 11h48</span>, balance <span>R201</span> (<span>Transactional</span>).</p>" },
  ])("recovers an omitted immediate-payment body payee from the subject (%j)", (body) => {
    const parsed = parseBankZeroEmail({
      subject: "Gustav: Pay Immediately R400.00 to Example Payee with reference 'Household' on 12 Oct-26 Mon 11h48, balance R201(Transactional)",
      ...body,
    });
    expect(parsed).toMatchObject({
      messageClass: "paid", outcome: "movement_candidate", direction: "debit",
      amountMinor: 40000, paymentMethod: "immediate_payment",
      counterparty: "Example Payee", reference: "Household", accountAlias: "Transactional",
      eventAt: "2026-10-12T11:48:00+02:00", balanceMinor: 20100,
      sourceFields: { counterparty: "subject", amountMinor: "body", reference: "body", eventAt: "body" },
    });
    expect(parsed.conflict).toBeUndefined();
  });

  it("holds a missing payee when neither subject nor body supplies one", () => {
    const parsed = parseBankZeroEmail({
      subject: "Gustav: Pay Immediately R400.00 to with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
    });
    expect(parsed).toMatchObject({ messageClass: "paid", outcome: "review", reference: "Household" });
    expect(parsed.counterparty).toBeUndefined();
  });

  it("still holds amount conflicts when the body omits the payee", () => {
    const parsed = parseBankZeroEmail({
      subject: "Gustav: Pay Immediately R400.00 to Example Payee with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
      text: "Pay Immediately R500.00 to with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
    });
    expect(parsed).toMatchObject({ outcome: "review", conflict: "amountMinor differs between subject and body" });
  });

  it("still holds genuinely different payees in the subject and body", () => {
    const parsed = parseBankZeroEmail({
      subject: "Pay Immediately R400.00 to Example Payee with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
      text: "Pay Immediately R400.00 to Another Payee with reference 'Household' on 12 Oct-26 Mon 11h48 (Transactional)",
    });
    expect(parsed).toMatchObject({ outcome: "review", conflict: "counterparty differs between subject and body" });
  });

  it.each(["Gustav: ", "Cara: ", "Bank Zero: ", ""])("recognizes recipient-added notices with prefix %j", (prefix) => {
    const parsed = parseBankZeroEmail({
      subject: `${prefix}Pay recipient Example Payee added with Standard Bank account 000000001 by Example on 12 Oct-26 Mon 11h47.`,
      html: "<p>Pay recipient Example Payee added with Standard Bank account 000000001 by Example on 12 Oct-26 Mon 11h47.</p>",
    });
    expect(parsed).toMatchObject({ messageClass: "non_transaction", outcome: "no_movement" });
    expect(parsed.amountMinor).toBeUndefined();
    expect(parsed.direction).toBeUndefined();
  });

  it.each(["Gustav: ", "Cara: ", "Bank Zero: ", ""])("recognizes card timeout notices with prefix %j", (prefix) => {
    const parsed = parseBankZeroEmail({
      subject: `${prefix}Card Online Timeout Tried R72.30 at Example Merchant on 01 Dec-25 Mon 04h19, balance R569 (Transactional)`,
      html: "<p>Tried R72.30 at Example Merchant on 01 Dec-25 Mon 04h19. After 1 more timeouts Example Merchant will be added to your card subscriptions for you to enable, balance R569 (Transactional)</p>",
    });
    expect(parsed).toMatchObject({ messageClass: "non_transaction", outcome: "no_movement" });
    expect(parsed.amountMinor).toBeUndefined();
    expect(parsed.direction).toBeUndefined();
  });

  it("recognizes the timeout template when its attempted amount has no currency prefix", () => {
    const parsed = parseBankZeroEmail({
      subject: "Gustav: Card Online Timeout Tried 660.94 at Example Merchant on 22 Jun-26 Mon 13h41, balance ZAR 27 (Transactional)",
      text: "Hi Gustav, A secure 3DS online card transaction of 660.94 at Example Merchant was last tried on 22 Jun-26 Mon 13h41.",
    });
    expect(parsed).toMatchObject({ messageClass: "non_transaction", outcome: "no_movement" });
    expect(parsed.amountMinor).toBeUndefined();
  });

  it("does not treat notice keywords in payees, references, or fee descriptions as notices", () => {
    const payee = parseBankZeroEmail({
      subject: "Paid R100.00 to Sample Security on 12 Oct-26 Mon 11h44 (Transactional)",
    });
    const reference = parseBankZeroEmail({
      subject: "Paid R100.00 to Sample Merchant with reference 'Tax' on 12 Oct-26 Mon 11h44 (Transactional)",
    });
    const fee = parseBankZeroEmail({
      subject: "Card Fee: Tax Certificate R2.50 for R15.67 @ Sample Security on 02 Dec-25 Tue 07h56, balance R8 (Transactional)",
    });
    expect(payee).toMatchObject({ messageClass: "paid", outcome: "movement_candidate", counterparty: "Sample Security" });
    expect(reference).toMatchObject({ messageClass: "paid", outcome: "movement_candidate", reference: "Tax" });
    expect(fee).toMatchObject({ messageClass: "fee", outcome: "movement_candidate", amountMinor: 250 });
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

  it("holds a paid subject when the body says the payment was declined", () => {
    const parsed = parseBankZeroEmail({
      subject: "Paid R400.00 to Sample Merchant with reference 'Invoice A' on 12 Oct-26 Mon 11h44 (Transactional)",
      text: "Your payment was declined. Paid R400.00 to Sample Merchant on 12 Oct-26 Mon 11h44 (Transactional)",
    });
    expect(parsed).toMatchObject({
      messageClass: "unknown", outcome: "review",
      conflict: "outcome differs between subject and body",
    });
  });

  it("classifies a declined body before positive payment phrases", () => {
    const parsed = parseBankZeroEmail({
      subject: "Paid R400.00 to Sample Merchant with reference 'Invoice A' on 12 Oct-26 Mon 11h44 (Transactional)",
      text: "Paid R400.00 to Sample Merchant on 12 Oct-26 Mon 11h44 (Transactional). The payment was declined.",
    });
    expect(parsed).toMatchObject({ messageClass: "unknown", outcome: "review" });
  });

  it("recognizes proofs, statements, status, declines, and unknowns without making transactions", () => {
    expect(parseBankZeroEmail({ subject: "Bank Zero: Payment of R400.00 from Example to Merchant", attachments: [{ filename: "ProofOfPayment.pdf", mimetype: "application/pdf" }] }).messageClass).toBe("proof_of_payment");
    expect(parseBankZeroEmail({ subject: "Bank Statement for Transactional October2026", attachments: [{ filename: "Transactional October2026.xls", mimetype: "application/vnd.ms-excel" }] }).messageClass).toBe("statement");
    expect(parseBankZeroEmail({ subject: "Bank Zero: Banking status as at 11 Jan-26 Sun 06h00" }).outcome).toBe("review");
    expect(parseBankZeroEmail({ subject: "Card Online Timeout Tried R72.30 at Sample Taxi on 01 Dec-25 Mon 04h19" }).outcome).toBe("no_movement");
    expect(parseBankZeroEmail({ subject: "Security Alert: A new device was added" }).outcome).toBe("no_movement");
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
