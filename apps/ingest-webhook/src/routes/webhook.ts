import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import multipart from "@fastify/multipart";
import type { IngestWebhookConfig } from "../config.js";
import type { AuthPreHandlerContext } from "../middleware/auth.js";
import { addIngestJob, attachmentToPayload, type IngestJobPayload } from "../queue/client.js";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

interface WebhookOptions extends FastifyPluginOptions {
  config: IngestWebhookConfig;
  authPreHandler: (
    req: unknown,
    reply: unknown,
    context: AuthPreHandlerContext
  ) => Promise<void>;
}

function extractMessageId(headers: string): string {
  const match = /^Message-ID:\s*<?([^>\s]+)>?/im.exec(headers);
  if (match) return match[1].trim();
  return createHash("sha256").update(headers).digest("hex").slice(0, 32);
}

export async function webhookRoutes(
  fastify: FastifyInstance,
  opts: WebhookOptions
): Promise<void> {
  const { config, authPreHandler } = opts;
  const authContext: AuthPreHandlerContext = {
    ingestToken: config.ingestToken,
  };

  await fastify.register(multipart, {
    limits: { fileSize: 30 * 1024 * 1024 },
  });

  fastify.post(
    "/sendgrid",
    {
      preHandler: (req, reply) => authPreHandler(req, reply, authContext),
    },
    async (request, reply) => {
      const job_id = randomUUID();
      const log = request.log.child({ job_id });

      let from = "";
      let to = "";
      let subject = "";
      let headers = "";
      const attachments: IngestJobPayload["attachments"] = [];

      try {
        const fields: Record<string, string> = {};
        let part = await request.file();
        while (part) {
          const buffer = await part.toBuffer();
          if (part.filename && part.fieldname?.startsWith("attachment")) {
            const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
            attachments.push(
              attachmentToPayload(
                part.fieldname,
                part.filename,
                part.mimetype,
                buf
              )
            );
          } else {
            fields[part.fieldname] = buffer.toString("utf-8");
          }
          part = await request.file();
        }

        from = fields["from"] ?? "";
        to = fields["to"] ?? "";
        subject = fields["subject"] ?? "";
        headers = fields["headers"] ?? "";

        const message_id = extractMessageId(headers);
        const payload: IngestJobPayload = {
          job_id,
          message_id,
          from,
          to,
          subject,
          headers,
          attachments,
        };

        await addIngestJob(config, payload);
        log.info(
          { message_id, from, to, attachments_count: attachments.length },
          "Job queued"
        );
        return reply.status(200).send({ job_id, status: "queued" });
      } catch (err) {
        log.error({ err }, "Webhook handler error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
}
