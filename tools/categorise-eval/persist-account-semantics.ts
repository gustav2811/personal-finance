import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.LIVE_EVAL !== "1") {
    console.log("refusing without LIVE_EVAL=1");
    process.exit(1);
  }
  const url = required("SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_KEY");
  const seed = JSON.parse(readFileSync(path.join(root, "reports/categoriser/account-semantics.json"), "utf8")) as {
    accounts: { finwiseAccountId: string; displayName: string; role: string; ownerScope: string; context: string }[];
  };
  const rows = seed.accounts
    .filter((account) => account.role && account.context)
    .map((account) => ({
      finwise_account_id: account.finwiseAccountId,
      display_name: account.displayName,
      role: account.role,
      owner_scope: account.ownerScope || "household",
      context: account.context,
    }));
  const response = await fetch(`${url}/rest/v1/account_semantics`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
      "Content-Profile": "classifier",
    },
    body: JSON.stringify(rows),
  });
  const body = await response.text();
  console.log(JSON.stringify({
    status: response.status,
    rows: rows.length,
    ok: response.ok,
    hint: response.ok ? "written" : body.slice(0, 180),
  }));
  if (!response.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "persist failed");
  process.exit(1);
});
