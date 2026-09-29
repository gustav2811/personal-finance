import { describe, expect, it } from "vitest";
import {
  TUYA_CODES,
  assertTuyaDayClosed,
  aggregateTuyaKwh,
  buildTuyaConsumptionBatch,
  serializeTuyaLogs,
  tuyaDayWindow,
  tuyaPlanDates,
  type TuyaLogsByCode,
} from "./day.js";

function logs(): TuyaLogsByCode {
  return Object.fromEntries(TUYA_CODES.map((code) => [code, []])) as TuyaLogsByCode;
}

describe("Tuya day boundaries", () => {
  it("maps a Johannesburg calendar day to its UTC window", () => {
    expect(tuyaDayWindow("2026-09-28")).toEqual({
      start: "2026-09-27T22:00:00.000Z",
      end: "2026-09-28T22:00:00.000Z",
    });
  });

  it("rejects invalid calendar dates", () => {
    expect(() => tuyaDayWindow("2026-02-30")).toThrow("invalid Johannesburg date");
  });

  it("rejects today because it is still open", () => {
    expect(() =>
      assertTuyaDayClosed("2026-09-29", new Date("2026-09-29T07:00:00.000Z")),
    ).toThrow("Tuya day is not closed");
  });
});

describe("Tuya aggregation", () => {
  it("converts add_ele millikWh increments to kWh", () => {
    expect(
      aggregateTuyaKwh([
        { code: "add_ele", event_time: 1, value: "125" },
        { code: "add_ele", event_time: 2, value: "375" },
      ]),
    ).toBe(0.5);
  });

  it("uses a deterministic ingestion run key", () => {
    const batch = buildTuyaConsumptionBatch({
      deviceId: "device",
      date: "2026-09-28",
      logsByCode: logs(),
      startedAt: "2026-09-29T07:00:00.000Z",
      finishedAt: "2026-09-29T07:01:00.000Z",
    });
    expect(batch.ingestion_run.run_key).toBe("tuya:device:2026-09-28");
  });
});

describe("Tuya raw serialisation", () => {
  it("sorts entries by event time and emits NDJSON", () => {
    expect(
      serializeTuyaLogs([
        { code: "cur_power", event_time: 20, value: "2" },
        { code: "cur_power", event_time: 10, value: "1" },
      ]),
    ).toBe(
      '{"code":"cur_power","event_time":10,"value":"1"}\n' +
        '{"code":"cur_power","event_time":20,"value":"2"}\n',
    );
    expect(serializeTuyaLogs([])).toBe("");
  });
});

describe("Tuya planning dates", () => {
  it("plans only days fully inside Tuya retention at the cron time", () => {
    expect(tuyaPlanDates(new Date("2026-09-29T07:00:00.000Z"))).toEqual([
      "2026-09-28",
      "2026-09-27",
      "2026-09-26",
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
    ]);
  });
});

describe("Tuya test fixtures", () => {
  it("keeps the code list complete", () => {
    expect(logs()).toEqual({
      switch_1: [],
      cur_power: [],
      add_ele: [],
      cur_current: [],
      cur_voltage: [],
    });
  });
});
