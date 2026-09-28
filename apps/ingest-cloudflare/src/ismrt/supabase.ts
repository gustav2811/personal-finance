import type { ConsumptionBatch, JsonObject } from "./map.js";

const RPC_NAME = "ingest_consumption_batch";

export class ConsumptionRpc {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  ingest(batch: ConsumptionBatch): Promise<unknown> {
    return this.call(RPC_NAME, { p_payload: batch });
  }

  recordFailure(input: {
    startedAt: string;
    windowStart: string;
    windowEnd: string;
    error: string;
  }): Promise<unknown> {
    const run: JsonObject = {
      source: "ismrt",
      runner: "investments-ingest-consumer",
      status: "failed",
      started_at: input.startedAt,
      finished_at: new Date().toISOString(),
      window_start: input.windowStart,
      window_end: input.windowEnd,
      rows_fetched: 0,
      rows_written: 0,
      error: input.error.slice(0, 500),
      metadata: {},
    };
    return this.call(RPC_NAME, { p_payload: { ingestion_run: run } });
  }

  private async call(name: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`supabase ${name} ${await errorMessage(response)}`);
    }
    return response.json();
  }
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string };
    return body.message?.slice(0, 180) ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
