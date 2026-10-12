import { describe, expect, it } from "vitest";
import { finalizeIngestPayload } from "../payload-merge.js";

describe("finalizeIngestPayload", () => {
  it("preserves SendGrid text and HTML bodies with their original subject and delivery headers", async () => {
    const payload = await finalizeIngestPayload({
      job_id: "attempt-1",
      fields: {
        from: "e-services@bankzerosa.co.za",
        to: "profile-a@forwarding.test.invalid",
        subject: "Paid R50.00 to Sample Merchant on 12 Oct-26 Mon 11h44 (Transactional)",
        headers: "Message-ID: <original-1@bankzero.test.invalid>\nAuthentication-Results: mx.test; dkim=pass",
        text: "Paid R50.00 to Sample Merchant on 12 Oct-26 Mon 11h44 (Transactional)",
        html: "<p>Paid <span>R50.00</span> to <span>Sample Merchant</span></p>",
      },
      attachments: [],
    });

    expect(payload).toMatchObject({
      message_id: "original-1@bankzero.test.invalid",
      from: "e-services@bankzerosa.co.za",
      to: "profile-a@forwarding.test.invalid",
      text: "Paid R50.00 to Sample Merchant on 12 Oct-26 Mon 11h44 (Transactional)",
      html: "<p>Paid <span>R50.00</span> to <span>Sample Merchant</span></p>",
    });
  });

  it("uses parsed RFC 822 body and Message-ID when raw MIME is the source", async () => {
    const payload = await finalizeIngestPayload({
      job_id: "attempt-2",
      fields: {
        email: [
          "From: e-services@bankzerosa.co.za",
          "To: profile-a@forwarding.test.invalid",
          "Subject: Money Received R50.00 from Sample Person on 12 Oct-26 Mon 11h44 (Transactional)",
          "Message-ID: <original-2@bankzero.test.invalid>",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Money Received R50.00 from Sample Person on 12 Oct-26 Mon 11h44 (Transactional)",
        ].join("\r\n"),
      },
      attachments: [],
    });

    expect(payload.message_id).toBe("original-2@bankzero.test.invalid");
    expect(payload.text).toContain("Money Received R50.00");
  });
});
