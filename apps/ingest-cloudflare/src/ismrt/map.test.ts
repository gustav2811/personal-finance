import { describe, expect, it } from "vitest";
import { closedWindow, incurredInstant, ledgerSourceRecordId } from "./dates.js";
import { buildConsumptionBatch, type CaptureInput, type ExpenseRow } from "./map.js";

const WALLET = "78b8bf95-b4c2-48a8-831f-57c7d30f5510";
const METER = "ELON054810";
const WINDOW_END = "2026-08-24T22:00:00.000Z";

function expense(overrides: Partial<ExpenseRow> & Pick<ExpenseRow, "utilityType" | "date">): ExpenseRow {
  return {
    charge: null,
    debit: 1,
    credit: null,
    rate: null,
    meterSerial: null,
    consumption: null,
    reference: null,
    ...overrides,
  };
}

function capture(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    wallet: {
      id: WALLET,
      propertyName: "WORLDS VIEW BC",
      premiseName: "WORLDS VIEW B20",
      accountReference: "WZ00225979",
    },
    meters: [{ id: "meter-1", serial: METER }],
    expenses: [],
    deposits: [],
    invoices: [],
    proofs: [],
    profiles: [
      {
        serial: METER,
        intervalMinutes: 1440,
        intervals: [
          {
            startDate: "2026-08-22T22:00:00.000Z",
            endDate: "2026-08-23T22:00:00.000Z",
            measures: [
              {
                name: "forwardActiveEnergy",
                consumption: 14784,
                unit: "Wh",
                displayName: "Forward(kWh)",
                startValue: 5656958,
                endValue: 5671742,
              },
            ],
          },
          {
            startDate: "2026-08-23T22:00:00.000Z",
            endDate: "2026-08-24T22:00:00.000Z",
            measures: [
              {
                name: "forwardActiveEnergy",
                consumption: null,
                unit: "Wh",
                displayName: "Forward(kWh)",
                startValue: null,
                endValue: null,
              },
            ],
          },
        ],
      },
    ],
    windowStart: "2026-08-01T22:00:00.000Z",
    windowEnd: WINDOW_END,
    fetchedAt: "2026-08-25T04:00:00.000Z",
    ...overrides,
  };
}

describe("closed window", () => {
  it("ends at the last closed Johannesburg midnight", () => {
    expect(closedWindow(new Date("2026-09-28T04:00:00.000Z"), 45)).toEqual({
      start: "2026-08-13T22:00:00.000Z",
      end: "2026-09-27T22:00:00.000Z",
    });
  });
});

describe("incurred dates", () => {
  it("shifts a 22:00Z electricity close back to the usage day", () => {
    expect(
      incurredInstant({
        postedAt: "2026-08-23T22:00:00.000Z",
        utility: "electricity",
        entryType: "usage_charge",
        description: "ENERGY (SLIDING SCALE)",
      }),
    ).toEqual({
      occurredAt: "2026-08-22T22:00:00.000Z",
      rule: "daily_close",
    });
  });

  it("puts a named water month on the first of that month in Johannesburg", () => {
    expect(
      incurredInstant({
        postedAt: "2026-05-06T22:01:00.000Z",
        utility: "water",
        entryType: "usage_charge",
        description: "April monthly Water Usage 9.199 kl",
      }).occurredAt,
    ).toBe("2026-03-31T22:00:00.000Z");
  });

  it("rolls a December charge posted in January back a year", () => {
    expect(
      incurredInstant({
        postedAt: "2027-01-06T22:01:00.000Z",
        utility: "water",
        entryType: "usage_charge",
        description: "December monthly Water Usage 1 kl",
      }).occurredAt,
    ).toBe("2026-11-30T22:00:00.000Z");
  });

  it("does not treat a 22:00Z deposit or EFT fee as a usage close", () => {
    expect(
      incurredInstant({
        postedAt: "2026-08-23T22:00:00.000Z",
        utility: "wallet",
        entryType: "deposit",
        description: "PURCHASE",
      }).rule,
    ).toBe("event_timestamp");
    expect(
      incurredInstant({
        postedAt: "2026-08-23T22:00:00.000Z",
        utility: "wallet",
        entryType: "fee",
        description: "SUMS EFT FEE",
      }).rule,
    ).toBe("event_timestamp");
  });

  it("shifts only the daily subscription when a wallet fee closes at 22:00Z", () => {
    expect(
      incurredInstant({
        postedAt: "2026-08-23T22:00:00.000Z",
        utility: "wallet",
        entryType: "fee",
        description: "SUMS WORLDS VIEW BC SUBSCRIPTION FEE",
      }),
    ).toEqual({
      occurredAt: "2026-08-22T22:00:00.000Z",
      rule: "daily_close",
    });
  });

  it("keeps two wallets from sharing a ledger id", () => {
    const shared = {
      utility: "wallet",
      entryType: "fee",
      postedAt: "2026-08-23T22:00:00.000Z",
      direction: "debit",
      amount: 1.92,
      meterSerial: null,
      description: "SUMS WORLDS VIEW BC SUBSCRIPTION FEE",
      reference: null,
      occurrence: 0,
    };
    expect(ledgerSourceRecordId({ ...shared, walletId: "wallet-a" })).not.toBe(
      ledgerSourceRecordId({ ...shared, walletId: "wallet-b" }),
    );
  });

  it("keeps an EFT fee on its event timestamp", () => {
    expect(
      incurredInstant({
        postedAt: "2026-05-05T12:39:01.743Z",
        utility: "wallet",
        entryType: "fee",
        description: "SUMS EFT FEE",
      }),
    ).toEqual({
      occurredAt: "2026-05-05T12:39:01.743Z",
      rule: "event_timestamp",
    });
  });
});

describe("consumption batch", () => {
  it("writes electricity on the meter usage day and skips the open interval", async () => {
    const batch = await buildConsumptionBatch(
      capture({
        expenses: [
          expense({
            utilityType: "Electricity",
            charge: "ENERGY (SLIDING SCALE)",
            debit: 49.01,
            rate: 3.315105,
            date: "2026-08-23T22:00:00.000Z",
            meterSerial: METER,
            consumption: 14.784,
          }),
          expense({
            utilityType: "ismrt! Wallet Charges",
            charge: "SUMS WORLDS VIEW BC SUBSCRIPTION FEE",
            debit: 1.92,
            date: "2026-08-23T22:00:00.000Z",
          }),
        ],
      }),
    );

    const electricity = batch.ledger_entries.find((entry) => entry.utility_type === "electricity");
    expect(electricity).toMatchObject({
      source_record_id: ledgerSourceRecordId({
        walletId: WALLET,
        utility: "electricity",
        entryType: "usage_charge",
        postedAt: "2026-08-23T22:00:00.000Z",
        direction: "debit",
        amount: 49.01,
        meterSerial: METER,
        description: "ENERGY (SLIDING SCALE)",
        reference: null,
        occurrence: 0,
      }),
      occurred_at: "2026-08-22T22:00:00.000Z",
      posted_at: "2026-08-23T22:00:00.000Z",
      quantity: 14.784,
      quantity_unit: "kWh",
      device_external_id: METER,
    });
    expect(batch.readings).toEqual([
      expect.objectContaining({
        source_record_id:
          "meter_profile:ELON054810:2026-08-22T22:00:00.000Z:2026-08-23T22:00:00.000Z:forwardActiveEnergy",
        period_start: "2026-08-22T22:00:00.000Z",
        value: 14784,
        unit: "Wh",
      }),
    ]);
    expect(electricity?.occurred_at).toBe(batch.readings[0]?.period_start);
    expect(batch.ingestion_run.metadata).toMatchObject({ skipped_open_intervals: 1 });
  });

  it("assigns water quantity to one debit and dates it to the named month", async () => {
    const water = expense({
      utilityType: "Water",
      charge: "April monthly Water Usage 9.199 kl",
      debit: 184.62,
      date: "2026-05-06T22:01:00.000Z",
      reference: "April monthly Water Usage 9.199 kl",
    });
    const batch = await buildConsumptionBatch(
      capture({
        expenses: [
          water,
          water,
          { ...water, debit: null, credit: 184.62 },
        ],
      }),
    );
    const debits = batch.ledger_entries.filter((entry) => entry.direction === "debit");
    expect(debits.map((entry) => entry.quantity)).toEqual([9.199, null]);
    expect(debits.map((entry) => entry.source_record_id)).toEqual([
      `ismrt:ledger:${WALLET}:water:usage_charge:2026-05-06T22:01:00.000Z:debit:184.6200:-:April monthly Water Usage 9.199 kl:April monthly Water Usage 9.199 kl:0`,
      `ismrt:ledger:${WALLET}:water:usage_charge:2026-05-06T22:01:00.000Z:debit:184.6200:-:April monthly Water Usage 9.199 kl:April monthly Water Usage 9.199 kl:1`,
    ]);
    expect(debits[0]?.occurred_at).toBe("2026-03-31T22:00:00.000Z");
    expect(debits[0]?.device_external_id).toBe(`water:${WALLET}`);
  });

  it("does not write an expense stamped after the closed window", async () => {
    const batch = await buildConsumptionBatch(
      capture({
        expenses: [
          expense({
            utilityType: "Electricity",
            date: "2026-08-25T22:00:00.000Z",
            meterSerial: METER,
            consumption: 1,
          }),
        ],
      }),
    );
    expect(batch.ledger_entries).toHaveLength(0);
    expect(batch.ingestion_run.metadata).toMatchObject({ skipped_open_expenses: 1 });
  });
});
