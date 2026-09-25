export class FinanceRpc {
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  startSyncRun(householdId: string): Promise<string> {
    return this.call("finance_start_sync_run", {
      p_household_id: householdId,
      p_source_system: "finwise",
    });
  }

  finishSyncRun(syncRunId: string, status: "succeeded" | "failed", error: string | null): Promise<string> {
    return this.call("finance_finish_sync_run", {
      p_sync_run_id: syncRunId,
      p_status: status,
      p_error: error,
    });
  }

  upsertAccounts(householdId: string, rows: unknown[]): Promise<{ upserted: number; failed: number; error: string | null }> {
    return this.call("finance_upsert_source_accounts", {
      p_household_id: householdId,
      p_rows: rows,
    });
  }

  upsertCategories(
    householdId: string,
    rows: unknown[],
  ): Promise<{ mapped: { name: string; ownedCategoryId: string }[]; failed: number; error: string | null }> {
    return this.call("finance_upsert_source_categories", {
      p_household_id: householdId,
      p_rows: rows,
    });
  }

  upsertTransactions(
    householdId: string,
    syncRunId: string,
    rows: unknown[],
  ): Promise<{ ids: string[]; failed: number; error: string | null }> {
    return this.call("finance_upsert_source_transactions", {
      p_household_id: householdId,
      p_sync_run_id: syncRunId,
      p_rows: rows,
    });
  }

  recordClassificationRun(input: {
    householdId: string;
    transactionId: string;
    classifierVersion: string;
    modelId: string | null;
    inputTokenCount: number;
    result: unknown;
    ownedCategoryId: string | null;
    confidence: number | null;
    isTransfer: boolean | null;
    excludeFromSpend: boolean | null;
    nature: string | null;
  }): Promise<string> {
    return this.call("finance_record_classification_run", {
      p_household_id: input.householdId,
      p_transaction_id: input.transactionId,
      p_classifier_version: input.classifierVersion,
      p_model_id: input.modelId,
      p_input_token_count: input.inputTokenCount,
      p_result: input.result,
      p_owned_category_id: input.ownedCategoryId,
      p_confidence: input.confidence,
      p_is_transfer: input.isTransfer,
      p_exclude_from_spend: input.excludeFromSpend,
      p_nature: input.nature,
    });
  }

  private async call<T>(name: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
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
    return response.json() as Promise<T>;
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
