import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const API_BASE = "https://api.cloudflare.com/client/v4";

export function parseQueueNames(tomlText) {
  const names = new Set();
  const queuePattern = /^\s*queue\s*=\s*"([^"]+)"/gm;
  for (const match of tomlText.matchAll(queuePattern)) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

export function planQueueCreates(wanted, existing) {
  const existingNames = new Set(existing);
  return [...new Set(wanted)].filter((name) => !existingNames.has(name));
}

async function main() {
  const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const directory = dirname(fileURLToPath(import.meta.url));
  const tomlFiles = await Promise.all(
    ["../wrangler.consumer.toml", "../wrangler.ingest.toml"].map((file) =>
      readFile(join(directory, file), "utf8"),
    ),
  );
  const wanted = parseQueueNames(tomlFiles.join("\n"));
  if (wanted.length === 0) {
    throw new Error("No queue names found in Wrangler configuration");
  }

  const existing = await listQueues(accountId, apiToken);
  const creates = planQueueCreates(wanted, existing);
  for (const name of wanted) {
    log(existing.includes(name) ? "queue_existing" : "queue_missing", {
      queue_name: name,
    });
  }
  for (const name of creates) {
    await createQueue(accountId, apiToken, name);
    log("queue_created", { queue_name: name });
  }
}

async function listQueues(accountId, apiToken) {
  const queues = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${API_BASE}/accounts/${accountId}/queues`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const body = await requestJson(url, apiToken);
    if (!Array.isArray(body.result)) {
      throw new Error("Cloudflare queues response has no result array");
    }
    for (const queue of body.result) {
      if (!isRecord(queue) || typeof queue.queue_name !== "string") {
        throw new Error("Cloudflare queues response has an invalid queue");
      }
      queues.push(queue.queue_name);
    }
    const totalPages =
      isRecord(body.result_info) && typeof body.result_info.total_pages === "number"
        ? body.result_info.total_pages
        : page;
    if (page >= totalPages) return queues;
  }
}

async function createQueue(accountId, apiToken, name) {
  const url = `${API_BASE}/accounts/${accountId}/queues`;
  await requestJson(
    url,
    apiToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue_name: name }),
    },
  );
}

async function requestJson(input, apiToken, init = {}) {
  const response = await fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Cloudflare API returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok || !isRecord(body) || body.success !== true) {
    throw new Error(
      `Cloudflare API request failed HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return body;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function log(msg, fields) {
  console.log(JSON.stringify({ level: "info", msg, component: "ensure-queues", ...fields }));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "ensure_queues_failed",
        component: "ensure-queues",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
