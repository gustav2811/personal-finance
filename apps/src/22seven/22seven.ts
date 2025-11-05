import axios from "axios";
import type { AppConfig } from "../config";
import type {
  TwentyTwoSevenLoginTokens,
  TwentyTwoSevenSnapshot,
  TwentyTwoSevenTransaction,
} from "./types";
import { buildHeaders, PLATFORM_INFO } from "./headers.ts";

export async function loginTwentyTwoSeven(
  cfg: AppConfig
): Promise<TwentyTwoSevenLoginTokens> {
  const response = await axios.post("https://api.22seven.com/sessions", {
    username: cfg.twentyTwoSevenUsername,
    password: cfg.twentyTwoSevenPassword,
    rememberMe: false,
    platformInformation: PLATFORM_INFO,
  });

  const { customerId, sessionToken, requestToken } = response.data ?? {};
  if (!customerId || !sessionToken || !requestToken) {
    throw new Error("Login failed. Did not receive necessary tokens.");
  }
  return { customerId, sessionToken, requestToken };
}

export async function fetchAllSnapshots(
  tokens: TwentyTwoSevenLoginTokens
): Promise<TwentyTwoSevenSnapshot[]> {
  const dataUrl = `https://api.22seven.com/customer/${tokens.customerId}/accounts-balances`;
  const headers = buildHeaders(tokens);
  const response = await axios.get<TwentyTwoSevenSnapshot[]>(dataUrl, {
    headers,
  });
  return response.data ?? [];
}

/**
 * Fetches ALL transactions by combining the "hot" (aggregate) and "cold" (archived)
 * endpoints, then de-dupes them in memory.
 */
export async function fetchAllTransactions(
  tokens: TwentyTwoSevenLoginTokens
): Promise<TwentyTwoSevenTransaction[]> {
  const { customerId } = tokens;
  type AggregateResponse = {
    transactions?: TwentyTwoSevenTransaction[];
  };

  // 1. Create the headers we'll reuse
  const headers = buildHeaders(tokens);

  // 2. Define the two API calls
  const hotDataUrl = `https://api.22seven.com/customer/${customerId}/aggregate`;
  const coldDataUrl = `https://api.22seven.com/customer/${customerId}/transactions/archived`;

  // 3. Run both calls in parallel!
  const [hotResponse, coldResponse] = await Promise.all([
    axios.get<AggregateResponse>(hotDataUrl, { headers }),
    axios.get<TwentyTwoSevenTransaction[]>(coldDataUrl, { headers }),
  ]);

  // 4. Pluck the data from the responses
  const hotTransactions = hotResponse.data?.transactions ?? [];

  // The 'cold' data *is* the response
  const coldTransactions = coldResponse.data ?? [];

  // 5. Combine and de-dupe
  const allTransactionsMap = new Map<string, TwentyTwoSevenTransaction>();

  for (const tx of coldTransactions) {
    allTransactionsMap.set(tx.id, tx);
  }
  for (const tx of hotTransactions) {
    allTransactionsMap.set(tx.id, tx);
  }

  // 6. Return the final, de-duped array
  return Array.from(allTransactionsMap.values());
}
