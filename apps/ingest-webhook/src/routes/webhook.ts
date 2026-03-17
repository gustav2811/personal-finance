import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import multipart from "@fastify/multipart";
import { simpleParser } from "mailparser";
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

function formatAddress(addr: unknown): string | undefined {
  if (addr == null) return undefined;
  if (typeof addr === "string") return addr.trim() || undefined;
  if (Array.isArray(addr)) return formatAddress(addr[0]);
  if (typeof addr === "object" && addr !== null && "text" in addr)
    return String((addr as { text: string }).text).trim() || undefined;
  return undefined;
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

        for await (const part of request.parts()) {
          log.debug(
            {
              type: part.type,
              fieldname: part.fieldname,
              ...(part.type === "file" ? { filename: part.filename } : {}),
            },
            "multipart part"
          );
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

        from = fields["from"] ?? "";
        to = fields["to"] ?? "";
        subject = fields["subject"] ?? "";
        headers = fields["headers"] ?? "";

        // When SendGrid sends raw MIME in fields.email, parse it for metadata and attachments (not extracted as separate parts).
        let message_id = extractMessageId(headers);
        const rawEmail = fields["email"];
        if (rawEmail) {
          const parsed = await simpleParser(rawEmail);
          from = formatAddress(parsed.from) ?? from;
          to = formatAddress(parsed.to) ?? to;
          subject = parsed.subject ?? subject;
          headers = rawEmail.slice(0, 8192);
          const parsedMessageId =
            typeof parsed.messageId === "string"
              ? parsed.messageId.trim()
              : undefined;
          if (parsedMessageId) message_id = parsedMessageId;
          for (let i = 0; i < (parsed.attachments?.length ?? 0); i++) {
            const att = parsed.attachments[i];
            const buf =
              Buffer.isBuffer(att.content)
                ? att.content
                : Buffer.from(att.content ?? []);
            attachments.push(
              attachmentToPayload(
                `mime-${i}`,
                att.filename ?? "attachment",
                att.contentType ?? "application/octet-stream",
                buf
              )
            );
          }
          log.debug(
            {
              attachments_from_mime: parsed.attachments?.length ?? 0,
              messageId: parsedMessageId,
            },
            "Parsed raw MIME from fields.email"
          );
        }

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
