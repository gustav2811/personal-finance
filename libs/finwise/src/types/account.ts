import type { Money } from "./common";

export type AccountType =
  | "depository"
  | "credit"
  | "loan"
  | "investment"
  | "other";

/**
 * Account object returned by the API.
 */
export interface Account {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  name: string;
  displayName: string | null;
  friendlyName: string | null;
  accountNumber: string | null;
  currentBalance: Money;
  availableBalance: Money | null;
  accountType: string | null;
  type: AccountType;
  subType: string | null;
  logoBase64: string | null;
  emoji: string | null;
  data: Record<string, unknown> | null;
  interestRate: number | null;
  interestRateType: string | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: Money | null;
  minimumAmountDue: Money | null;
  originationDate: string | null;
  amountDue: Money | null;
  originalLoanAmount: Money | null;
  archivedAt: string | null;
  isLinked: boolean | null;
  institutionId: string | null;
  institutionUserId: string | null;
  institution: unknown | null;
  excludeFromBudget?: boolean;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertAmounts?: boolean;
}

/**
 * Filters for listing accounts (GET /accounts).
 */
export interface AccountListFilters {
  id?: string;
  userId?: string;
  search?: string;
  isArchived?: boolean;
}

/**
 * Body for creating an account (POST /accounts).
 */
export interface CreateAccountBody {
  id?: string;
  userId: string;
  name: string;
  logoBase64?: string | null;
  emoji?: string | null;
  accountNumber?: string | null;
  currentBalance: Money;
  availableBalance?: Money | null;
  type: AccountType;
  subType?: string | null;
  originalLoanAmount?: Money | null;
  originationDate?: string | null;
  interestRate?: number | null;
  interestRateType?: string | null;
  lastPaymentDate?: string | null;
  lastPaymentAmount?: Money | null;
  amountDue?: Money | null;
  minimumAmountDue?: Money | null;
  archivedAt?: string | null;
  data?: Record<string, unknown> | null;
  excludeFromBudget?: boolean;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertAmounts?: boolean;
}

/**
 * Body for updating an account (PATCH /accounts/:id). All fields optional.
 */
export interface UpdateAccountBody {
  name?: string;
  logoBase64?: string | null;
  emoji?: string | null;
  accountNumber?: string | null;
  currentBalance?: Money;
  availableBalance?: Money | null;
  type?: AccountType;
  subType?: string | null;
  originalLoanAmount?: Money | null;
  originationDate?: string | null;
  interestRate?: number | null;
  interestRateType?: string | null;
  lastPaymentDate?: string | null;
  lastPaymentAmount?: Money | null;
  amountDue?: Money | null;
  minimumAmountDue?: Money | null;
  archivedAt?: string | null;
  data?: Record<string, unknown> | null;
  excludeFromBudget?: boolean;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertAmounts?: boolean;
}
