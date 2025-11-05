import axios from "axios";
import type { AppConfig } from "../config";

export type TwentyTwoSevenAmount = {
  amount: number;
  currencyCode: string;
};

export type TwentyTwoSevenSnapshot = {
  accountId: string;
  date: number | string;
  amount: TwentyTwoSevenAmount;
};

export type TwentyTwoSevenLoginTokens = {
  customerId: string;
  sessionToken: string;
  requestToken: string;
};

const PLATFORM_INFO = {
  appVersion: "Web (React)",
  deviceType: "Chrome 142.0.0.0",
  osVersion: "Macintosh; Intel Mac OS X 10_15_7",
  versionCode: null as number | null,
  appBuild: null as number | null,
};

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
  const headers = {
    "x-request-token": tokens.requestToken,
    "x-session-token": tokens.sessionToken,
    accept: "application/json",
    origin: "https://app.22seven.com",
    referer: "https://app.22seven.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  } as const;
  const response = await axios.get<TwentyTwoSevenSnapshot[]>(dataUrl, {
    headers,
  });
  return response.data ?? [];
}
