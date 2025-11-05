import type { VercelRequest, VercelResponse } from "@vercel/node";
import { syncSnapshots } from "../apps/src/scripts/accountBalances";

export default async function (
  request: VercelRequest,
  response: VercelResponse
) {
  try {
    await syncSnapshots();
    response.status(200).json({ success: true, message: "Sync completed." });
  } catch (error) {
    console.error("Cron job failed:", error.message);
    throw error;
  }
}
