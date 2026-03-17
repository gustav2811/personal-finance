import type {
  TransactionCategory,
  TransactionCategoryListFilters,
  CreateTransactionCategoryBody,
  DeleteTransactionCategoryBody,
} from "../types/transaction-category";
import type { PaginationParams } from "../types/common";
import type { RequestQuery } from "../client";

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  query?: RequestQuery
) => Promise<T>;

function buildListQuery(
  filters?: TransactionCategoryListFilters,
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

export interface TransactionCategoriesApi {
  list(options?: {
    filters?: TransactionCategoryListFilters;
    pagination?: PaginationParams;
  }): Promise<TransactionCategory[]>;
  create(body: CreateTransactionCategoryBody): Promise<TransactionCategory>;
  delete(id: string, body?: DeleteTransactionCategoryBody): Promise<TransactionCategory>;
}

export function createTransactionCategoriesApi(
  request: RequestFn
): TransactionCategoriesApi {
  return {
    async list(options) {
      const query = buildListQuery(options?.filters, options?.pagination);
      return request<TransactionCategory[]>(
        "GET",
        "/transaction-categories",
        undefined,
        query
      );
    },
    create(body) {
      return request<TransactionCategory>(
        "POST",
        "/transaction-categories",
        body
      );
    },
    delete(id, body) {
      return request<TransactionCategory>(
        "DELETE",
        `/transaction-categories/${encodeURIComponent(id)}`,
        body ?? undefined
      );
    },
  };
}
