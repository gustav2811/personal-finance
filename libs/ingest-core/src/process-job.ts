import type { IngestCoreConfig } from "./config.js";
import type { IngestJobPayload } from "./job-payload.js";
import { payloadToBuffer } from "./job-payload.js";
import {
  detectBank,
  getParserForBank,
  pickBestAttachment,
  type CanonicalTransaction,
} from "./parsers/index.js";
import { getAccountIdForBankAndFilename } from "./parsers/bank-config.js";
import { validateAll } from "./parsers/validate.js";
import { categoriseTransactions } from "./lib/categorisation/pipeline.js";
import {
  createFinwiseClient,
  postTransactionsToFinwise,
} from "./lib/finwise.js";
import { createProcessedStore, sendToDlq } from "./lib/dlq.js";

export interface ProcessJobLogger {
  child: (bindings: Record<string, unknown>) => ProcessJobLogger;
  warn: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
  info: (o: unknown, msg?: string) => void;
}

export async function processIngestJob(
  config: IngestCoreConfig,
  payload: IngestJobPayload,
  logger: ProcessJobLogger,
): Promise<void> {
  const log = logger.child({
    job_id: payload.job_id,
    message_id: payload.message_id,
    from: payload.from,
  });

  const attachment = pickBestAttachment(payload.attachments);
  if (!attachment) {
    log.warn(
      {
        attachments_count: payload.attachments.length,
        filenames: payload.attachments.map((a) => a.filename),
        mimetypes: payload.attachments.map((a) => a.mimetype),
      },
      "No XLSX/XLS/CSV attachment, sending to DLQ",
    );
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: "unknown",
      error: "No XLSX, XLS, or CSV attachment",
      payload: {
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        attachments_count: payload.attachments.length,
      },
    });
    return;
  }

  const buffer = payloadToBuffer(attachment);
  const toEmail = payload.to.includes("@")
    ? payload.to.split("@")[0]
    : payload.to;
  const bankCode = detectBank(payload.from, toEmail, attachment.filename);
  if (!bankCode) {
    log.warn(
      { filename: attachment.filename },
      "Could not detect bank, sending to DLQ",
    );
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: "unknown",
      error: "Could not detect bank from from/to/filename",
      payload: {
        from: payload.from,
        to: payload.to,
        filename: attachment.filename,
      },
    });
    return;
  }

  const parser = getParserForBank(bankCode);
  if (!parser) {
    log.warn({ bankCode }, "No parser for bank, sending to DLQ");
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: bankCode,
      error: `No parser registered for bank: ${bankCode}`,
      payload: { from: payload.from, filename: attachment.filename },
    });
    return;
  }

  const accountId = getAccountIdForBankAndFilename(
    config,
    bankCode,
    attachment.filename,
    payload.subject,
  );
  if (!accountId) {
    log.warn(
      { bankCode, filename: attachment.filename },
      "No account_id for bank/filename, sending to DLQ",
    );
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: bankCode,
      error: `No account_id configured for bank: ${bankCode}`,
      payload: { from: payload.from, filename: attachment.filename },
    });
    return;
  }

  const plog = log.child({ account_id: accountId, bank: bankCode });

  plog.info(
    {
      filename: attachment.filename,
      mimetype: attachment.mimetype,
    },
    "ingest_parse_start",
  );

  let transactions: CanonicalTransaction[];
  try {
    const out = await parser(buffer, {
      bank: bankCode,
      source_email: payload.from,
      filename: attachment.filename,
      account_id: accountId,
    });
    transactions = await Promise.resolve(out);
  } catch (err) {
    plog.error({ err }, "Parser failed, sending to DLQ");
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: bankCode,
      error: err instanceof Error ? err.message : String(err),
      payload: {
        from: payload.from,
        filename: attachment.filename,
      },
    });
    throw err;
  }

  const { valid, invalid } = validateAll(transactions);
  plog.info(
    {
      rows_parsed: transactions.length,
      rows_valid: valid.length,
      rows_invalid: invalid.length,
    },
    "ingest_parse_complete",
  );

  if (invalid.length > 0) {
    plog.warn({ invalid_count: invalid.length }, "Some rows failed validation");
  }

  if (valid.length === 0) {
    plog.info("No valid transactions to post");
    return;
  }

  if (!config.uploadToFinwise) {
    plog.info(
      { transactions_eligible: valid.length },
      "Upload disabled; transactions not posted",
    );
    return;
  }

  const finwise = createFinwiseClient(
    config.finwiseApiKey,
    config.finwiseBaseUrl,
    { error: (msg, meta) => plog.error(meta, msg) },
  );

  let transactionsToPost = valid;
  if (config.categorisationEnabled) {
    transactionsToPost = await categoriseTransactions(
      config,
      finwise,
      valid,
      plog,
    );
    plog.info(
      {
        categorisation_per_tx: transactionsToPost.map((t) => ({
          external_id: t.external_id,
          classification_source: t.classification_source,
          classification_confidence: t.classification_confidence,
          category_id: t.transaction_category_id,
        })),
      },
      "categorisation_per_transaction",
    );
  }

  const processedStore = createProcessedStore(config);

  const result = await postTransactionsToFinwise({
    finwise,
    processedStore,
    transactions: transactionsToPost,
    log: plog,
  });

  plog.info(
    {
      transactions_eligible: valid.length,
      finwise_created: result.created,
      finwise_skipped: result.skipped,
      finwise_failed_count: result.failed.length,
    },
    "ingest_finwise_post_complete",
  );

  if (result.failed.length > 0) {
    await sendToDlq(config, {
      job_id: payload.job_id,
      message_id: payload.message_id,
      bank: bankCode,
      error: `Finwise create failed for ${result.failed.length} transaction(s)`,
      payload: {
        from: payload.from,
        filename: attachment.filename,
        transactions_count: valid.length,
        failed: result.failed,
      },
    });
  }
}
