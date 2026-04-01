import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { bankZeroParser } from "../bank-zero.js";

function buildBankZeroXlsxBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const summaryRows = [["Summary"], ["Total", "1000"]];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Feb 26 Summary");

  const transactionRows = [
    ["Date", "Day", "Time", "Type", "Description 1", "Description 2", "Fee", "Amount", "Balance", "Has Attachments"],
    ["2026-02-05", "Thu", "17:22", "Card purchase", "Sprinkles Bake & Par", "Albertsville, Apple Pay", "0.00", "-130.50", "32 157.91", "No"],
    ["2026-02-08", "Sun", "19:37", "Transfer in", "Gustav Klingbiel", "February", "0.00", "7 300.00", "30 657.91", "No"],
  ];
  const txWs = XLSX.utils.aoa_to_sheet(transactionRows);
  XLSX.utils.book_append_sheet(wb, txWs, "Feb 26 Transactions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

describe("bankZeroParser", () => {
  it("uses sheet whose name includes Transactions, not Summary", () => {
    const buffer = buildBankZeroXlsxBuffer();
    const ctx = {
      bank: "bank_zero",
      source_email: "notifications@bankzero.co.za",
      filename: "Feb 26 Transactions.xlsx",
      account_id: "finwise-account-123",
    };
    const result = bankZeroParser(buffer, ctx);
    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject({
      account_id: "finwise-account-123",
      date: "2026-02-05",
      amount: -130.5,
      currency: "ZAR",
      description: "Albertsville, Apple Pay",
      counterparty: "Sprinkles Bake & Par",
      balance: 32157.91,
      meta: { bank: "bank_zero", source_email: ctx.source_email, filename: ctx.filename },
    });
    expect(result[1].amount).toBe(7300);
    expect(result[1].description).toBe("February");
    expect(result[1].counterparty).toBe("Gustav Klingbiel");
  });

  it("parses amount with space as thousands separator", () => {
    const buffer = buildBankZeroXlsxBuffer();
    const ctx = {
      bank: "bank_zero",
      source_email: "a@b.co",
      filename: "f.xlsx",
      account_id: "acc1",
    };
    const result = bankZeroParser(buffer, ctx);
    expect(result[0].amount).toBe(-130.5);
    expect(result[1].amount).toBe(7300);
    expect(result[0].balance).toBe(32157.91);
  });

  it("parses amount with comma as thousands separator (e.g. from CSV export)", () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Date", "Type", "Description 1", "Description 2", "Amount", "Balance"],
      ["2026-02-08", "Transfer out", "Travel Savings", "February", "-1,500.00", "30,657.91"],
      ["2026-02-08", "Pay out", "Gustav Klingbiel", "San Lameer travel", "-1,364.00", "29,293.91"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, "Feb 26 Transactions");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const ctx = {
      bank: "bank_zero",
      source_email: "a@b.co",
      filename: "f.xlsx",
      account_id: "acc1",
    };
    const result = bankZeroParser(buffer, ctx);
    expect(result[0].amount).toBe(-1500);
    expect(result[0].balance).toBe(30657.91);
    expect(result[1].amount).toBe(-1364);
    expect(result[1].balance).toBe(29293.91);
  });

  it("produces deterministic external_id for same row", () => {
    const buffer = buildBankZeroXlsxBuffer();
    const ctx = {
      bank: "bank_zero",
      source_email: "a@b.co",
      filename: "f.xlsx",
      account_id: "acc1",
    };
    const result1 = bankZeroParser(buffer, ctx);
    const result2 = bankZeroParser(buffer, ctx);
    expect(result2[0].external_id).toBe(result1[0].external_id);
  });
});
