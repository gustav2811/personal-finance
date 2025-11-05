import { type TwentyTwoSevenLoginTokens } from "./types";

export const PLATFORM_INFO = {
  appVersion: "Web (React)",
  deviceType: "Chrome 142.0.0.0",
  osVersion: "Macintosh; Intel Mac OS X 10_15_7",
  versionCode: null as number | null,
  appBuild: null as number | null,
};

const ORIGIN = "https://app.22seven.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export const buildHeaders = (tokens: TwentyTwoSevenLoginTokens) => ({
  "x-request-token": tokens.requestToken,
  "x-session-token": tokens.sessionToken,
  accept: "application/json",
  origin: ORIGIN,
  referer: `${ORIGIN}/`,
  "user-agent": USER_AGENT,
});
