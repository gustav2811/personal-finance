import type {
  Transaction,
  TransactionListFilters,
  TransactionAggregatedParams,
  TransactionAggregatedItem,
  CreateTransactionBody,
} from "../types/transaction";
import type { PaginationParams } from "../types/common";
import type { RequestQuery } from "../client";

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  query?: RequestQuery
) => Promise<T>;

function buildListQuery(
  filters?: TransactionListFilters,
  pagination?: PaginationParams
): RequestQuery | undefined {
  const query: RequestQuery = {};
  if (filters && Object.keys(filters).length > 0) {
    query.filters = filters;
  }
  if (pagination && (pagination.pageNumber != null || pagination.pageSize != null)) {
    query.pagination = {
      pageNumber: pagination.pageNumber,
      pageSize: pagination.pageSize,
    };
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

export interface TransactionsApi {
  list(options?: {
    filters?: TransactionListFilters;
    pagination?: PaginationParams;
  }): Promise<Transaction[]>;
  getAggregated(
    params: TransactionAggregatedParams
  ): Promise<TransactionAggregatedItem[]>;
  create(body: CreateTransactionBody): Promise<Transaction>;
  archive(id: string): Promise<Transaction>;
}

export function createTransactionsApi(request: RequestFn): TransactionsApi {
  return {
    async list(options) {
      const query = buildListQuery(options?.filters, options?.pagination);
      return request<Transaction[]>("GET", "/transactions", undefined, query);
    },
    async getAggregated(params) {
      const query: RequestQuery = {
        aggregateBy: params.aggregateBy,
        aggregateFn: params.aggregateFn,
      };
      if (params.currencyCode) query.currencyCode = params.currencyCode;
      if (params.filters && Object.keys(params.filters).length > 0) {
        query.filters = params.filters;
      }
      if (params.pagination) query.pagination = params.pagination;
      return request<TransactionAggregatedItem[]>(
        "GET",
        "/transactions/aggregated3",
        undefined,
        query
      );
    },
    create(body) {
      return request<Transaction>("POST", "/transactions", body);
    },
    archive(id) {
      return request<Transaction>(
        "POST",
        `/transactions/${encodeURIComponent(id)}/archive`
      );
    },
  };
}
