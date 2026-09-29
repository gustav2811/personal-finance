import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_CRITERIA,
  createCloudflareJevModel,
  ExperimentBudget,
  slugOf,
} from "../../libs/categoriser/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_ID = "0975bb8e042b737788a61583e2ec6cfc";
const GATEWAY_ID = "finance-ai-gateway";

const QUERIES = [
  "orchestra concert",
  "concert",
  "vet",
  "dog food",
  "uber",
  "petrol",
  "netflix",
  "dentist",
  "birthday present",
  "haircut",
  "flight to cape town",
  "fibre",
  "gym",
  "latte",
  "nando's",
  "woolworths",
  "salary",
  "airbnb",
  "parking",
  "aws",
];

function cloudflareToken(): string {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return execFileSync("npx", ["wrangler", "auth", "token"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim().split("\n").pop() ?? "";
}

function questions(variant: "names" | "criteria"): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const [name, criterion] of Object.entries(CATEGORY_CRITERIA)) {
    criteria[slugOf(name)] = variant === "names" ? name : `${name}: ${criterion}`;
  }
  return {
    category: {
      type: "choice",
      instructions:
        "The person typed a short phrase while picking a personal-finance category for a bank transaction. Choose the category the phrase most likely means.",
      criteria,
    },
  };
}

async function classifyWithRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 3 || !(error instanceof Error) || !error.message.includes("503")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
}

async function main(): Promise<void> {
  if (process.env.LIVE_EVAL !== "1") throw new Error("set LIVE_EVAL=1");
  const budget = new ExperimentBudget(0.2);
  const model = createCloudflareJevModel({
    accountId: ACCOUNT_ID,
    apiToken: cloudflareToken(),
    gatewayId: GATEWAY_ID,
    budget,
  });
  const nameBySlug = new Map(Object.keys(CATEGORY_CRITERIA).map((name) => [slugOf(name), name]));
  for (const variant of ["names", "criteria"] as const) {
    const q = questions(variant);
    for (const text of QUERIES) {
      const started = performance.now();
      const choice = await classifyWithRetry(() => model.classify({ state: { text }, questions: q }));
      const ms = Math.round(performance.now() - started);
      const top = Object.entries(choice.probabilities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([slug, p]) => `${nameBySlug.get(slug) ?? slug} ${(p * 100).toFixed(0)}%`)
        .join(", ");
      process.stdout.write(
        `${JSON.stringify({ variant, text, ms, confidence: Number(choice.confidence.toFixed(2)), top, tokens: choice.usage.inputTokens })}\n`,
      );
    }
  }
  process.stdout.write(`${JSON.stringify({ budget: budget.snapshot() })}\n`);
}

void main();
