export type TwentyTwoSevenTransaction = {
  // Identifiers
  id: string;
  accountId: string;
  merchantId: string | null;

  // Core info
  description: string;
  amount: TransactionAmount;
  transactionDate: number; // epoch ms

  // Categorization
  categoryId: string;
  spendingGroupId: string;
  tags: string[];

  // Relationship data
  isParentTransaction: boolean;
  childTransactions: string[];
  isChildTransaction: boolean;
  parentId: string;

  // Status flags
  isDeleted: boolean;
  isManual: boolean;
  isArchived: boolean;

  // Metadata
  payPeriod: number;
  note: string | null;
};

export type TransactionAmount = {
  amount: number;
  currencyCode: string;
  debitOrCredit: DebitOrCredit;
};

export enum DebitOrCredit {
  DEBIT = "debit",
  CREDIT = "credit",
}

export type TwentyTwoSevenSnapshot = {
  accountId: string;
  date: number | string;
  amount: TransactionAmount;
};

export type TwentyTwoSevenLoginTokens = {
  customerId: string;
  sessionToken: string;
  requestToken: string;
};
