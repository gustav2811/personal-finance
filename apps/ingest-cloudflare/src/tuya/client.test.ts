import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTuyaStringToSign, createTuyaSignature } from "./client.js";

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
