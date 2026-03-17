import type { Money } from "./common";

export type AccountBalanceType = "manual" | "synced";

/**
 * Account balance object (snapshot of balance on a date).
 */
export interface AccountBalance {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  userId: string;
  date: string;
  amount: Money | null;
  type: AccountBalanceType;
  dataImportId: string | null;
  archivedAt: string | null;
  tt7Details?: unknown | null;
  isManual?: boolean | null;
}

/**
 * Filters for listing account balances (GET /account-balances).
 */
export interface AccountBalanceListFilters {
  id?: string;
  ids?: string[];
  accountId?: string;
  accountIds?: string[];
  userId?: string;
  fromDate?: string;
  toDate?: string;
  isPositive?: boolean;
  isNegative?: boolean;
  excludeExcluded?: boolean;
}

/**
 * Body for creating an account balance (POST /account-balances).
 */
export interface CreateAccountBalanceBody {
  accountId: string;
  date: string;
  amount: Money;
}

/**
 * Aggregate-by options for GET /account-balances/aggregated2.
 */
export type AccountBalanceAggregateBy = "day" | "week" | "Month" | "Year";

export type AccountBalanceAggregateFn = "latest";

/**
 * Params for aggregated account balances.
 */
export interface AccountBalanceAggregatedParams {
  aggregateBy: AccountBalanceAggregateBy[];
  aggregateFn: AccountBalanceAggregateFn;
  currencyCode?: string;
  filters?: AccountBalanceListFilters;
  pagination?: { pageNumber?: number; pageSize?: number };
}

/**
 * Single aggregated balance result (date + amount).
 */
export interface AccountBalanceAggregatedItem {
  date: string;
  amount: number;
}
