import type {
  Account,
  AccountListFilters,
  CreateAccountBody,
  UpdateAccountBody,
} from "../types/account";
import type { PaginationParams } from "../types/common";
import type { RequestQuery } from "../client";

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  query?: RequestQuery
) => Promise<T>;

function buildQuery(
  filters?: AccountListFilters,
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

export interface AccountsApi {
  list(
    options?: { filters?: AccountListFilters; pagination?: PaginationParams }
  ): Promise<Account[]>;
  get(id: string): Promise<Account>;
  create(body: CreateAccountBody): Promise<Account>;
  update(id: string, body: UpdateAccountBody): Promise<Account>;
  archive(id: string): Promise<Account>;
}

export function createAccountsApi(request: RequestFn): AccountsApi {
  return {
    async list(options) {
      const query = buildQuery(options?.filters, options?.pagination);
      return request<Account[]>("GET", "/accounts", undefined, query);
    },
    get(id) {
      return request<Account>("GET", `/accounts/${encodeURIComponent(id)}`);
    },
    create(body) {
      return request<Account>("POST", "/accounts", body);
    },
    update(id, body) {
      return request<Account>("PATCH", `/accounts/${encodeURIComponent(id)}`, body);
    },
    archive(id) {
      return request<Account>("POST", `/accounts/${encodeURIComponent(id)}/archive`);
    },
  };
}
