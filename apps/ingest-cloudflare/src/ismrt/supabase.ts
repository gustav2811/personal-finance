import { callServiceRoleRpc } from "@investments/source-rpc";
import type { ConsumptionBatch, JsonObject } from "./map.js";

const RPC_NAME = "ingest_consumption_batch";

export type IngestHealth = {
  tuya_reading_exists: boolean;
  ismrt_latest_period_end: string | null;
};

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

  health(tuyaSourceRecordId: string): Promise<IngestHealth> {
    return this.call("ingest_health", {
      p_tuya_source_record_id: tuyaSourceRecordId,
    });
  }

  private call<T = unknown>(name: string, body: unknown): Promise<T> {
    return callServiceRoleRpc<T>(
      this.url,
      this.key,
      name,
      body,
      this.fetchImpl,
    );
  }
}
