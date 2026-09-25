import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FinWiseClient } from "../../libs/finwise/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const suggested: Record<string, string> = {
  loan: "mortgage",
  investment: "investment",
  credit: "credit_card",
};

async function main(): Promise<void> {
  if (process.env.LIVE_EVAL !== "1") {
    console.log("refusing without LIVE_EVAL=1");
    process.exit(1);
  }
  const client = new FinWiseClient({
    apiKey: required("FINWISE_API_KEY"),
    baseUrl: process.env.FINWISE_BASE_URL,
  });
  const accounts = await client.accounts.list({ pagination: { pageNumber: 1, pageSize: 100 } });
  const seed = {
    note: "Fill role and context before a household-memory eval. Empty context is ignored. Do not commit this file.",
    accounts: accounts.map((account) => ({
      finwiseAccountId: account.id,
      displayName: account.displayName || account.friendlyName || account.name,
      finwiseType: account.type,
      suggestedRole: suggested[account.type] ?? "",
      role: "",
      ownerScope: "household",
      context: "",
    })),
    relationships: [],
  };
  const out = path.join(root, "reports", "categoriser", "account-semantics.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(seed, null, 2));
  console.log(JSON.stringify({
    accounts: seed.accounts.map((account) => ({
      displayName: account.displayName,
      finwiseType: account.finwiseType,
      suggestedRole: account.suggestedRole || null,
    })),
  }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "seed failed");
  process.exit(1);
});
