export type { IngestCoreConfig, BankZeroAccountMapping } from "./config.js";
export { parseBankZeroAccountMapJson } from "./config.js";
export type { IngestJobPayload, IngestJobAttachment } from "./job-payload.js";
export {
  attachmentToPayload,
  payloadToBuffer,
} from "./job-payload.js";
export { finalizeIngestPayload } from "./payload-merge.js";
export { processIngestJob, type ProcessJobLogger } from "./process-job.js";
export {
  sendToDlq,
  createProcessedStore,
  countDlqSince,
  type DlqEntry,
} from "./lib/dlq.js";
export {
  createFinwiseClient,
  postTransactionsToFinwise,
} from "./lib/finwise.js";
export {
  detectBank,
  pickBestAttachment,
  getParserForBank,
  parseDomainFromFromHeader,
} from "./parsers/index.js";
export type {
  CanonicalTransaction,
  ParserContext,
  BankParser,
} from "./parsers/types.js";

/** Queue message from ingest Worker → consumer (v1 schema). */
export type IngestQueueMessageV1 = {
  v: 1;
  job_id: string;
  /** Inline email body when under size threshold; else use email_r2_key */
  email?: string;
  email_r2_key?: string;
  /** Multipart text fields except `email` when stored in R2 */
  fields: Record<string, string>;
  attachments: Array<{
    fieldname: string;
    filename: string;
    mimetype: string;
    r2_key: string;
  }>;
};
