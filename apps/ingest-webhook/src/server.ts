import Fastify from "fastify";
import { getConfig } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { webhookRoutes } from "./routes/webhook.js";
import { authPreHandler } from "./middleware/auth.js";
import { registerRateLimit } from "./middleware/rateLimit.js";

async function build() {
  const config = getConfig();
  const isDev = config.nodeEnv === "development";

  const fastify = Fastify({
    logger: {
      level: isDev ? "debug" : "info",
      transport:
        isDev
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss Z" } }
          : undefined,
    },
  });

  await registerRateLimit(fastify, config);
  fastify.register(healthRoutes);
  fastify.register(webhookRoutes, {
    prefix: "/webhook",
    config,
    authPreHandler,
  });

  return fastify;
}

async function main() {
  const config = getConfig();
  const app = await build();

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
