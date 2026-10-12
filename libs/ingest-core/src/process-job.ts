import type { IngestCoreConfig } from "./config.js";
import type { IngestJobPayload } from "./job-payload.js";
import { payloadToBuffer } from "./job-payload.js";
import { parseBankZeroEmail } from "./parsers/bank-zero-email.js";
import {
  detectBank,
  getParserForBank,
  pickBestAttachment,
  type CanonicalTransaction,
} from "./parsers/index.js";
import {
  recordBankZeroObservation,
  recordBankZeroStatementRow,
  type BankZeroReceiptContext,
} from "./lib/bank-zero-ingest.js";
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

export type ProcessIngestJobOptions = {
  replayPayload?: Record<string, unknown>;
  bankZeroReceipt?: BankZeroReceiptContext;
  statementStartRow?: number;
  scheduleStatementContinuation?: (nextStartRow: number) => Promise<void>;
};

const BANK_ZERO_STATEMENT_CHUNK_SIZE = 100;

export async function processIngestJob(
  config: IngestCoreConfig,
  payload: IngestJobPayload,
  logger: ProcessJobLogger,
  options: ProcessIngestJobOptions = {},
): Promise<void> {
  const log = logger.child({
    job_id: payload.job_id,
    message_id: payload.message_id,
    from: payload.from,
  });

  const detectedBank = detectBank(payload.from, payload.to, "");
  const hasStatementAttachment = pickBestAttachment(payload.attachments) !== undefined;
  if (detectedBank === "bank_zero" && !hasStatementAttachment) {
    const observation = parseBankZeroEmail({
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments: payload.attachments.map(({ filename, mimetype }) => ({ filename, mimetype })),
    });
    if (!options.bankZeroReceipt) {
      throw new Error("Bank Zero email has no durable receipt context");
    }
    const stored = await recordBankZeroObservation(
      config,
      options.bankZeroReceipt,
      payload,
      observation,
    );
    log.info(
      {
        message_class: observation.messageClass,
        parser_version: observation.parserVersion,
        receipt_outcome: stored.status,
        route_status: stored.route_status,
        ...(stored.account_id ? { account_id: stored.account_id } : {}),
      },
      "bank_zero_observation_recorded",
    );
    return;
  }

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
      replay_payload: options.replayPayload,
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
      replay_payload: options.replayPayload,
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
      replay_payload: options.replayPayload,
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
      replay_payload: options.replayPayload,
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
      replay_payload: options.replayPayload,
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

  if (bankCode === "bank_zero") {
    if (!options.bankZeroReceipt) {
      throw new Error("Bank Zero statement has no durable receipt context");
    }
    const attachmentPointer = options.bankZeroReceipt.attachments.find(
      (item) => item.filename === attachment.filename,
    );
    if (!attachmentPointer?.sha256) {
      throw new Error("Bank Zero statement attachment has no durable content hash");
    }
    const searchText = `${payload.subject} ${attachment.filename}`.toLowerCase();
    const aliasMapping = config.bankZeroAccountMap.find(
      (mapping) => mapping.accountId === accountId && searchText.includes(mapping.pattern.toLowerCase()),
    );
    if (!aliasMapping) {
      throw new Error("Bank Zero statement account alias is not explicitly mapped for this route");
    }
    const startRow = options.statementStartRow ?? 0;
    const chunk = valid.slice(startRow, startRow + BANK_ZERO_STATEMENT_CHUNK_SIZE);
    for (const row of chunk) {
      const result = await recordBankZeroStatementRow(
        config,
        options.bankZeroReceipt,
        payload,
        row,
        aliasMapping.alias ?? aliasMapping.pattern,
        attachmentPointer.sha256,
        aliasMapping.accountNumber,
      );
      plog.info(
        {
          statement_row: row.meta.statement_row,
          evidence_status: result.status,
          ...(result.account_id ? { account_id: result.account_id } : {}),
        },
        "bank_zero_statement_row_recorded",
      );
    }
    if (startRow + chunk.length < valid.length) {
      if (!options.scheduleStatementContinuation) {
        throw new Error("Bank Zero statement needs a durable continuation queue");
      }
      await options.scheduleStatementContinuation(startRow + chunk.length);
      plog.info(
        { parsed_rows: valid.length, next_row: startRow + chunk.length },
        "bank_zero_statement_continuation_scheduled",
      );
    }
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
      replay_payload: options.replayPayload,
    });
  }
}
