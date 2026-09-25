export interface FinwiseTxn {
  id: string;
  date: string;
  updatedAt: string | null;
  description: string;
  amount: { amount: string; currencyCode: string } | null;
  transactionCategoryId: string | null;
  originalTransactionCategoryId: string | null;
  merchantId: string | null;
  notes: string | null;
  accountId: string;
  isTransfer: boolean | null;
  needsReview: boolean | null;
  merchant?: { name?: string | null } | null;
}

export interface FinwiseCategory {
  id: string;
  name: string;
}

export class FinwiseHttp {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`FinWise HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  async listRecent(fromDate: string, pageSize: number, maxPages = 5): Promise<FinwiseTxn[]> {
    const out: FinwiseTxn[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const query = new URLSearchParams({
        filters: JSON.stringify({ fromDate, excludeArchived: true }),
        pagination: JSON.stringify({ pageNumber: page, pageSize }),
      });
      const batch = await this.request<FinwiseTxn[]>(`/transactions?${query.toString()}`);
      out.push(...batch);
      if (batch.length < pageSize) break;
    }
    return out;
  }

  async listMerchants(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (let page = 1; page <= 4; page++) {
      const query = new URLSearchParams({
        pagination: JSON.stringify({ pageNumber: page, pageSize: 100 }),
      });
      const batch = await this.request<{ id: string; name: string }[]>(`/merchants?${query.toString()}`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const merchant of batch) names.set(merchant.id, merchant.name);
      if (batch.length < 100) break;
    }
    return names;
  }

  listAccounts(): Promise<{ id: string; name: string; type: string | null }[]> {
    const query = new URLSearchParams({
      pagination: JSON.stringify({ pageNumber: 1, pageSize: 100 }),
    });
    return this.request<{ id: string; name: string; displayName?: string | null; type?: string | null }[]>(
      `/accounts?${query.toString()}`,
    ).then((accounts) =>
      accounts.map((account) => ({
        id: account.id,
        name: account.displayName || account.name,
        type: account.type ?? null,
      })),
    );
  }

  listCategories(): Promise<FinwiseCategory[]> {
    const query = new URLSearchParams({
      pagination: JSON.stringify({ pageNumber: 1, pageSize: 100 }),
    });
    return this.request<FinwiseCategory[]>(`/transaction-categories?${query.toString()}`);
  }

  updateCategory(id: string, categoryId: string): Promise<FinwiseTxn> {
    return this.request<FinwiseTxn>(`/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        transactionCategoryId: categoryId,
        needsReview: false,
      }),
    });
  }
}

export function merchantNameOf(tx: FinwiseTxn, merchants?: ReadonlyMap<string, string>): string | null {
  const named = tx as FinwiseTxn & { merchantName?: string | null };
  return named.merchantName ?? tx.merchant?.name ?? (tx.merchantId ? merchants?.get(tx.merchantId) ?? null : null);
}

export function signedAmount(tx: FinwiseTxn): number {
  const raw = tx.amount?.amount;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
