import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTuyaStringToSign,
  createTuyaSignature,
  TuyaClient,
} from "./client.js";
import { TuyaRateLimitedError } from "./errors.js";

describe("Tuya signing", () => {
  it("builds the documented string and uppercase HMAC signature", async () => {
    const input = {
      accessId: "client-id",
      accessSecret: "secret",
      accessToken: "token",
      timestamp: "1730000000000",
      method: "GET",
      body: "",
      pathWithQuery: "/v1.0/token?grant_type=1",
    };
    const bodyHash = createHash("sha256").update(input.body).digest("hex");
    const stringToSign = [
      input.method,
      bodyHash,
      "",
      input.pathWithQuery,
    ].join("\n");
    const expected = createHmac("sha256", input.accessSecret)
      .update(input.accessId + input.accessToken + input.timestamp + stringToSign)
      .digest("hex")
      .toUpperCase();

    await expect(
      buildTuyaStringToSign(input.method, input.body, input.pathWithQuery),
    ).resolves.toBe(stringToSign);
    await expect(createTuyaSignature(input)).resolves.toBe(expected);
  });
});

describe("Tuya errors", () => {
  it("raises TuyaRateLimitedError for code 40000309", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ success: false, code: 40000309, msg: "The log query is too frequent", tid: "t1" });
    const client = new TuyaClient("client-id", "secret", { fetchImpl, now: () => 1 });
    await expect(client.authenticate()).rejects.toBeInstanceOf(TuyaRateLimitedError);
  });
});
