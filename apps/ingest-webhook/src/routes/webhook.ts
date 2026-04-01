import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import multipart from "@fastify/multipart";
import type { IngestWebhookConfig } from "../config.js";
import type { AuthPreHandlerContext } from "../middleware/auth.js";
import {
  addIngestJob,
  attachmentToPayload,
  type IngestJobPayload,
} from "../queue/client.js";
import { randomUUID } from "crypto";
import { finalizeIngestPayload } from "@investments/ingest-core";

interface WebhookOptions extends FastifyPluginOptions {
  config: IngestWebhookConfig;
  authPreHandler: (
    request: FastifyRequest,
    reply: FastifyReply,
    context: AuthPreHandlerContext
  ) => Promise<void>;
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

      try {
        const fields: Record<string, string> = {};
        const attachments: IngestJobPayload["attachments"] = [];

        for await (const part of request.parts()) {
          if (part.type === "file") {
            const buffer = await part.toBuffer();
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
            const value = part.value;
            fields[part.fieldname] =
              typeof value === "string" ? value : String(value ?? "");
          }
        }

        const payload = await finalizeIngestPayload({
          job_id,
          fields,
          attachments,
        });

        await addIngestJob(config, payload);
        log.info(
          { message_id: payload.message_id, from: payload.from, to: payload.to, attachments_count: payload.attachments.length },
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
