import type { Money } from "./common";

/**
 * Transaction object returned by the API.
 */
export interface Transaction {
  id: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  originalDescription: string | null;
  accountId: string;
  amount: Money | null;
  date: string;
  effectiveDate: string | null;
  transactionCategoryId: string | null;
  originalTransactionCategoryId: string | null;
  merchantId: string | null;
  originalMerchantId: string | null;
  parentTransactionId: string | null;
  splits: unknown | null;
  isManual: boolean;
  isTransfer: boolean | null;
  notes: string | null;
  userId: string;
  archivedAt: string | null;
  dataImportId: string | null;
  needsReview: boolean | null;
  isPending: boolean | null;
  pendingTransactionId: string | null;
  transactionTags: unknown[];
  fileRecords: unknown[];
}

/**
 * Filters for listing transactions (GET /transactions).
 */
export interface TransactionListFilters {
  id?: string;
  ids?: string[];
  accountId?: string;
  accountIds?: string[];
  transactionCategoryIds?: string[];
  userId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  needsReview?: boolean;
  transactionTypes?: ("debit" | "credit")[];
  amountGte?: number;
  amountLte?: number;
  excludeParentTransactions?: boolean;
  excludeTransfers?: boolean;
  excludeArchived?: boolean;
  excludeExcludedTransactions?: boolean;
}

/**
 * Body for creating a transaction (POST /transactions).
 * API requires description (string); notes is optional.
 */
export interface CreateTransactionBody {
  accountId: string;
  date: string;
  description: string;
  effectiveDate?: string | null;
  amount: Money;
  transactionCategoryId?: string | null;
  merchantId?: string | null;
  isTransfer?: boolean | null;
  notes?: string | null;
}

/**
 * Aggregate-by options for GET /transactions/aggregated3.
 */
export type TransactionAggregateBy = "day" | "week" | "Month" | "Year";

export type TransactionAggregateFn = "sum";

/**
 * Params for aggregated transactions.
 */
export interface TransactionAggregatedParams {
  aggregateBy: TransactionAggregateBy[];
  aggregateFn: TransactionAggregateFn;
  currencyCode?: string;
  filters?: TransactionListFilters;
  pagination?: { pageNumber?: number; pageSize?: number };
}

/**
 * Single aggregated transaction result.
 */
export interface TransactionAggregatedItem {
  date: string;
  amount: number;
}
