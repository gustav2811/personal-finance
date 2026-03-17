/**
 * Transaction category object returned by the API.
 */
export interface TransactionCategory {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  userId: string;
  transactionCategoryGroupId: string | null;
  color: string | null;
  emoji: string | null;
  markTransactionsAsTransfers: boolean | null;
  excludeTransactionsFromBudget: boolean | null;
  consolidateInBudget: boolean | null;
  enableRollover: boolean | null;
  rolloverFromDate: string | null;
  archivedAt?: string | null;
}

/**
 * Filters for listing transaction categories (GET /transaction-categories).
 */
export interface TransactionCategoryListFilters {
  id?: string;
  userId?: string;
  name?: string;
  transactionCategoryGroupIds?: string[];
}

/**
 * Body for creating a transaction category (POST /transaction-categories).
 */
export interface CreateTransactionCategoryBody {
  id?: string;
  name: string;
  color?: string | null;
  emoji?: string | null;
  userId?: string;
  transactionCategoryGroupId?: string | null;
  markTransactionsAsTransfers?: boolean;
  excludeTransactionsFromBudget?: boolean;
  consolidateInBudget?: boolean;
  enableRollover?: boolean;
  rolloverFromDate?: string | null;
}

/**
 * Body for deleting a transaction category (DELETE /transaction-categories/:id).
 * Optional: reassign transactions to another category.
 */
export interface DeleteTransactionCategoryBody {
  reassignToTransactionCategoryId?: string;
}
