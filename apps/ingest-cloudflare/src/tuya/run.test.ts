import { describe, expect, it } from "vitest";
import {
  routeQueueMessage,
  type ConsumerQueueMessage,
} from "./run.js";

describe("queue message routing", () => {
  it("routes explicitly typed Tuya messages to the day handler", () => {
    const message: ConsumerQueueMessage = {
      type: "tuya-day",
      deviceId: "bf425b172390340134huph",
      date: "2026-09-28",
    };
    expect(routeQueueMessage(message)).toEqual({
      type: "tuya-day",
      message,
    });
  });

  it("keeps legacy untyped email messages on the email handler", () => {
    const message: ConsumerQueueMessage = {
      v: 1,
      job_id: "job-1",
      fields: {},
      attachments: [],
      email: "From: test@example.com",
    };
    expect(routeQueueMessage(message)).toEqual({
      type: "email-ingest",
      message,
    });
  });
});
