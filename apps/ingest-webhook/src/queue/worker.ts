import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { getConfig } from "../config.js";
import type { IngestJobPayload } from "./client.js";
import { processIngestJob, type ProcessJobLogger } from "@investments/ingest-core";

const QUEUE_NAME = "email-ingest";
const isDev = process.env.NODE_ENV === "development";
const logger = pino({
  level: "info",
  transport: isDev
    ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss Z" } }
    : undefined,
});

function toProcessLogger(p: pino.Logger): ProcessJobLogger {
  return {
    child: (b) => toProcessLogger(p.child(b)),
    warn: (o, m) => p.warn(o, m),
    error: (o, m) => p.error(o, m),
    info: (o, m) => p.info(o, m),
  };
}

async function processJob(payload: IngestJobPayload): Promise<void> {
  const config = getConfig();
  await processIngestJob(config, payload, toProcessLogger(logger));
}

async function main() {
  const config = getConfig();
  const worker = new Worker<IngestJobPayload>(
    QUEUE_NAME,
    async (job) => {
      await processJob(job.data);
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    logger.info({ job_id: job.id }, "Job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ job_id: job?.id, err }, "Job failed");
  });

  logger.info("Worker started");
  process.on("SIGTERM", async () => {
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.fatal(err);
  process.exit(1);
});
