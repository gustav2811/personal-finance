/**
 * Amount with currency (used for balances, transactions, etc.)
 */
export interface Money {
  amount: number;
  currencyCode: string;
}

/**
 * Pagination query params for list endpoints.
 */
export interface PaginationParams {
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Pagination object sent in query string (JSON-serialized).
 */
export interface Pagination {
  pageNumber?: number;
  pageSize?: number;
}
