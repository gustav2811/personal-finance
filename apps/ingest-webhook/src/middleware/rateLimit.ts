import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { IngestWebhookConfig } from "../config.js";

export async function registerRateLimit(
  fastify: FastifyInstance,
  _config: IngestWebhookConfig
): Promise<void> {
  await fastify.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });
}
