import { createHash } from "crypto";
import { simpleParser } from "mailparser";
import {
  attachmentToPayload,
  type IngestJobAttachment,
  type IngestJobPayload,
} from "./job-payload.js";

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

const MIMETYPE_EXT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

function getAttachmentFilename(
  filename: string | undefined,
  contentType: string | undefined,
  index: number,
): string {
  const name = (typeof filename === "string" && filename.trim()) || "attachment";
  if (/\.(xlsx|xls|csv)$/i.test(name)) return name;
  const mt = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = MIMETYPE_EXT[mt];
  if (ext) return name.includes(".") ? name : `${name}.${ext}`;
  return name;
}

/**
 * After multipart fields and file attachments are collected, merge SendGrid raw MIME (`email` field) if present.
 * Same shape as the ingest Worker expects after multipart parsing.
 */
export async function finalizeIngestPayload(options: {
  job_id: string;
  fields: Record<string, string>;
  attachments: IngestJobAttachment[];
}): Promise<IngestJobPayload> {
  const { job_id, fields } = options;
  let from = fields["from"] ?? "";
  let to = fields["to"] ?? "";
  let subject = fields["subject"] ?? "";
  let headers = fields["headers"] ?? "";
  const attachments = [...options.attachments];

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
      const buf = Buffer.isBuffer(att.content)
        ? att.content
        : Buffer.from(att.content ?? []);
      const filename = getAttachmentFilename(
        att.filename,
        att.contentType,
        i,
      );
      attachments.push(
        attachmentToPayload(
          `mime-${i}`,
          filename,
          att.contentType ?? "application/octet-stream",
          buf,
        ),
      );
    }
  }

  return {
    job_id,
    message_id,
    from,
    to,
    subject,
    headers,
    attachments,
  };
}
