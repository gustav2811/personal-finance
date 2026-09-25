export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const EXPERIMENT_BUDGET_USD = 5;
export const EXPERIMENT_STOP_USD = 4.5;

export function notionalUsd(inputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) return 0;
  return inputTokens * JEV_USD_PER_INPUT_TOKEN;
}

export class ExperimentBudget {
  spentNotionalUsd = 0;
  chargedUsd = 0;
  requests = 0;
  inputTokens = 0;

  constructor(private readonly stopUsd = EXPERIMENT_STOP_USD) {}

  canSpend(inputTokens: number): boolean {
    return this.spentNotionalUsd + notionalUsd(inputTokens) <= this.stopUsd;
  }

  record(inputTokens: number, chargedUsd = 0): number {
    const cost = notionalUsd(inputTokens);
    if (this.spentNotionalUsd + cost > this.stopUsd) {
      throw new Error(
        `JEV notional budget stop at $${this.stopUsd.toFixed(2)} (spent $${this.spentNotionalUsd.toFixed(4)})`,
      );
    }
    this.spentNotionalUsd += cost;
    this.chargedUsd += chargedUsd;
    this.requests += 1;
    this.inputTokens += inputTokens;
    return cost;
  }

  snapshot(): {
    requests: number;
    inputTokens: number;
    notionalUsd: number;
    chargedUsd: number;
    stopUsd: number;
  } {
    return {
      requests: this.requests,
      inputTokens: this.inputTokens,
      notionalUsd: this.spentNotionalUsd,
      chargedUsd: this.chargedUsd,
      stopUsd: this.stopUsd,
    };
  }
}
