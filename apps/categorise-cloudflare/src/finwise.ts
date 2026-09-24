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

  listRecent(fromDate: string, pageSize: number): Promise<FinwiseTxn[]> {
    const query = new URLSearchParams({
      filters: JSON.stringify({ fromDate, excludeArchived: true }),
      pagination: JSON.stringify({ pageNumber: 1, pageSize }),
    });
    return this.request<FinwiseTxn[]>(`/transactions?${query.toString()}`);
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

export function merchantNameOf(tx: FinwiseTxn): string | null {
  const named = tx as FinwiseTxn & { merchantName?: string | null };
  return named.merchantName ?? tx.merchant?.name ?? null;
}

export function signedAmount(tx: FinwiseTxn): number {
  const raw = tx.amount?.amount;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
