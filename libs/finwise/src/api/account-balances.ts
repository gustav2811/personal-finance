import type {
  AccountBalance,
  AccountBalanceListFilters,
  AccountBalanceAggregatedParams,
  AccountBalanceAggregatedItem,
  CreateAccountBalanceBody,
} from "../types/account-balance";
import type { PaginationParams } from "../types/common";
import type { RequestQuery } from "../client";

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  query?: RequestQuery
) => Promise<T>;

function buildListQuery(
  filters?: AccountBalanceListFilters,
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

export interface AccountBalancesApi {
  list(options?: {
    filters?: AccountBalanceListFilters;
    pagination?: PaginationParams;
  }): Promise<AccountBalance[]>;
  getAggregated(
    params: AccountBalanceAggregatedParams
  ): Promise<AccountBalanceAggregatedItem[]>;
  create(body: CreateAccountBalanceBody): Promise<AccountBalance>;
  archive(id: string): Promise<AccountBalance>;
}

export function createAccountBalancesApi(request: RequestFn): AccountBalancesApi {
  return {
    async list(options) {
      const query = buildListQuery(options?.filters, options?.pagination);
      return request<AccountBalance[]>("GET", "/account-balances", undefined, query);
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
      return request<AccountBalanceAggregatedItem[]>(
        "GET",
        "/account-balances/aggregated2",
        undefined,
        query
      );
    },
    create(body) {
      return request<AccountBalance>("POST", "/account-balances", body);
    },
    archive(id) {
      return request<AccountBalance>(
        "POST",
        `/account-balances/${encodeURIComponent(id)}/archive`
      );
    },
  };
}
