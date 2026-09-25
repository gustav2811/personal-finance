import { ExperimentBudget } from "../cost.js";
import type { DecisionModel, JevChoice } from "../types.js";
import { parseJevChoice } from "./parse.js";
import { CATEGORY_QUESTION } from "./build.js";

export interface CloudflareJevConfig {
  accountId: string;
  apiToken: string;
  gatewayId: string;
  budget?: ExperimentBudget;
  fetchImpl?: typeof fetch;
  collectLog?: boolean;
}

export function createCloudflareJevModel(config: CloudflareJevConfig): DecisionModel {
  const fetchImpl = config.fetchImpl ?? fetch;
  const budget = config.budget;
  return {
    async classify(input): Promise<JevChoice> {
      const body = JSON.stringify({
        model: "typesafe/jev",
        input: {
          state: input.state,
          questions: input.questions,
        },
      });
      let waitMs = 1500;
      let response: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        response = await fetchImpl(
          `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiToken}`,
              "Content-Type": "application/json",
              "cf-aig-gateway-id": config.gatewayId,
              "cf-aig-collect-log": config.collectLog === true ? "true" : "false",
            },
            body,
          },
        );
        if (response.status !== 429 && response.status !== 529) break;
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : waitMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
        waitMs = Math.min(waitMs * 2, 20000);
      }
      if (!response || !response.ok) {
        throw new Error(`JEV HTTP ${response?.status ?? 0}`);
      }
      const payload: unknown = await response.json();
      const choice = parseJevChoice(payload, CATEGORY_QUESTION);
      budget?.record(choice.usage.inputTokens, 0);
      return choice;
    },
  };
}

export interface AiBinding {
  run(
    model: string,
    input: unknown,
    options?: {
      gateway?: { id: string; skipCache?: boolean; collectLog?: boolean };
    },
  ): Promise<unknown>;
}

export function createBindingJevModel(input: {
  ai: AiBinding;
  gatewayId: string;
  budget?: ExperimentBudget;
}): DecisionModel {
  return {
    async classify(request): Promise<JevChoice> {
      const payload = await input.ai.run(
        "typesafe/jev",
        { state: request.state, questions: request.questions },
        {
          gateway: {
            id: input.gatewayId,
            skipCache: true,
            collectLog: false,
          },
        },
      );
      const choice = parseJevChoice(payload, CATEGORY_QUESTION);
      input.budget?.record(choice.usage.inputTokens, 0);
      return choice;
    },
  };
}
