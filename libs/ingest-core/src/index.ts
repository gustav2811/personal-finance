export type { IngestCoreConfig, BankZeroAccountMapping } from "./config.js";
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
  listOpenDlqGroupsSince,
  type DlqGroup,
  type DlqEntry,
} from "./lib/dlq.js";
export {
  createFinwiseClient,
  postTransactionsToFinwise,
  ChunkIncomplete,
  CHUNK_SIZE,
} from "./lib/finwise.js";
export { HISTORY_LOOKUP_DEFERRED } from "./lib/categorisation/history.js";
export {
  detectBank,
  pickBestAttachment,
  getParserForBank,
  parseDomainFromFromHeader,
} from "./parsers/index.js";
export type {
  CanonicalTransaction,
  ClassificationSource,
  ParserContext,
  BankParser,
} from "./parsers/types.js";
export { validateAll } from "./parsers/validate.js";
export {
  parseBankZeroEmail,
  type BankZeroEmailInput,
  type BankZeroFinancialObservation,
  type BankZeroMessageClass,
} from "./parsers/bank-zero-email.js";
export {
  processBankZeroPublicationBatch,
  type BankZeroPublicationLogger,
} from "./lib/bank-zero-publication.js";
export { expireBankZeroSourceBatch } from "./lib/bank-zero-retention.js";
export {
  claimBankZeroReviewReplayBatch,
  finishBankZeroReviewReplay,
  type BankZeroReplayClaim,
} from "./lib/bank-zero-review-replay.js";
export {
  categoriseTransactions,
  type CategorisationLogger,
} from "./lib/categorisation/pipeline.js";
export {
  fetchAllTransactionCategories,
  categoriesToIdNameMap,
} from "./lib/categorisation/fetch-categories.js";

/** Queue message from ingest Worker → consumer (v1 schema). */
export type IngestQueueMessageV1 = {
  v: 1;
  job_id: string;
  /** Trusted person/profile resolved from the route-specific webhook token. */
  route_key?: string;
  /** Transport attempt identity; the RFC 822 Message-ID remains separate. */
  delivery_id?: string;
  received_at?: string;
  /** Legacy inline body supported for messages queued before durable-R2 rollout. */
  email?: string;
  email_r2_key?: string;
  raw_email_sha256?: string;
  /** Multipart text fields except `email` when stored in R2 */
  fields: Record<string, string>;
  attachments: Array<{
    fieldname: string;
    filename: string;
    mimetype: string;
    r2_key: string;
    sha256?: string;
  }>;
};
