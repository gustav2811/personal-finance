export interface IngestJobAttachment {
  fieldname: string;
  filename: string;
  mimetype: string;
  /** Base64-encoded for JSON / queue serialization */
  bufferBase64: string;
}

export interface IngestJobPayload {
  job_id: string;
  message_id: string;
  from: string;
  to: string;
  subject: string;
  headers: string;
  attachments: IngestJobAttachment[];
}

export function attachmentToPayload(
  fieldname: string,
  filename: string,
  mimetype: string,
  buffer: Buffer,
): IngestJobAttachment {
  return {
    fieldname,
    filename,
    mimetype,
    bufferBase64: buffer.toString("base64"),
  };
}

export function payloadToBuffer(att: IngestJobAttachment): Buffer {
  return Buffer.from(att.bufferBase64, "base64");
}
