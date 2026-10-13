import { describe, expect, it } from "vitest";
import {
  createDlqReportJob,
  createHealthCheckJob,
  createBankZeroStatementJob,
  createIsmrtSyncJob,
  createTuyaDayJob,
  createTuyaPlanJob,
  parseJob,
} from "./jobs.js";

describe("scheduled job parsing", () => {
  it("constructs deterministic v1 job ids", () => {
    expect(createDlqReportJob("2026-09-29T07:00:00.000Z")).toEqual({
      v: 1,
      jobId: "dlq-report:2026-09-29",
      type: "dlq-report",
    });
    expect(createIsmrtSyncJob("2026-09-29T07:00:00.000Z")).toEqual({
      v: 1,
      jobId: "ismrt-sync:2026-09-29",
      type: "ismrt-sync",
      scheduledTime: "2026-09-29T07:00:00.000Z",
    });
    expect(createTuyaPlanJob("2026-09-29T07:00:00.000Z")).toEqual({
      v: 1,
      jobId: "tuya-plan:2026-09-29",
      type: "tuya-plan",
      scheduledTime: "2026-09-29T07:00:00.000Z",
    });
    expect(createHealthCheckJob("2026-09-29T10:00:00.000Z")).toEqual({
      v: 1,
      jobId: "health-check:2026-09-29",
      type: "health-check",
      scheduledTime: "2026-09-29T10:00:00.000Z",
    });
    expect(createTuyaDayJob("device", "2026-09-28")).toEqual({
      v: 1,
      jobId: "tuya-day:device:2026-09-28",
      type: "tuya-day",
      deviceId: "device",
      date: "2026-09-28",
    });
    expect(createTuyaDayJob("device", "2026-09-28", ["add_ele"])).toEqual({
      v: 1,
      jobId: "tuya-day:device:2026-09-28:add_ele",
      type: "tuya-day",
      deviceId: "device",
      date: "2026-09-28",
      codes: ["add_ele"],
    });
  });

  it("parses a v1 job", () => {
    const job = createTuyaDayJob("device", "2026-09-28", ["add_ele"]);
    expect(parseJob(job)).toEqual({ ok: true, job });
  });

  it("persists statement continuation cursors separately from email retry state", () => {
    const source = {
      v: 1 as const,
      job_id: "source-1",
      route_key: "profile-a",
      delivery_id: "delivery-1",
      received_at: "2026-10-12T10:00:00.000Z",
      fields: {},
      email_r2_key: "ingest/00000000-0000-4000-8000-000000000001/email.raw",
      raw_email_sha256: "a".repeat(64),
      attachments: [{
        fieldname: "attachment1", filename: "Transactional.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        r2_key: "ingest/00000000-0000-4000-8000-000000000001/files/0",
        sha256: "b".repeat(64),
      }],
    };
    const job = createBankZeroStatementJob(source, 100);
    expect(job.jobId).toBe("bank-zero-statement:source-1:100");
    expect(parseJob(job)).toEqual({ ok: true, job });
    expect(parseJob({ ...job, source: { ...source, email: "inline" } })).toEqual({ ok: false, reason: "invalid" });
  });

  it("upgrades an unversioned legacy job", () => {
    expect(
      parseJob({
        type: "tuya-day",
        deviceId: "device",
        date: "2026-09-28",
        codes: ["add_ele"],
      }),
    ).toEqual({
      ok: true,
      job: createTuyaDayJob("device", "2026-09-28", ["add_ele"]),
    });
  });

  it("rejects unsupported versions without treating them as invalid", () => {
    expect(parseJob({ v: 2, type: "tuya-plan" })).toEqual({
      ok: false,
      reason: "unsupported_version",
      v: 2,
    });
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { v: 1, type: "ismrt-sync", scheduledTime: "not-a-date", jobId: "bad" },
    { type: "health-check", scheduledTime: "2026-09-29T10:00:00.000Z" },
    { v: 1, type: "tuya-day", deviceId: "device", date: "2026-09-28", jobId: "bad" },
  ])("returns invalid for garbage body %#", (body) => {
    expect(parseJob(body)).toEqual({ ok: false, reason: "invalid" });
  });
});
