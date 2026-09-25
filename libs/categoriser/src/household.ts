export type AccountRole =
  | "current"
  | "credit_card"
  | "mortgage"
  | "savings"
  | "investment"
  | "expense_reserve"
  | "other";

export interface AccountSemantic {
  finwiseAccountId: string;
  displayName: string;
  role: AccountRole;
  ownerScope: "household" | "external";
  context: string;
}

export interface RelationshipSemantic {
  sourceFinwiseAccountId: string;
  destinationFinwiseAccountId: string | null;
  counterpartyKey: string | null;
  context: string;
}

export function householdState(input: {
  accountId: string;
  counterpartyKey: string;
  destinationAccountId?: string | null;
  accounts: readonly AccountSemantic[];
  relationships: readonly RelationshipSemantic[];
}): Record<string, unknown> | null {
  const account = input.accounts.find((item) => item.finwiseAccountId === input.accountId);
  const destination = input.destinationAccountId
    ? input.accounts.find((item) => item.finwiseAccountId === input.destinationAccountId)
    : undefined;
  const relationship = input.relationships.find((item) =>
    item.sourceFinwiseAccountId === input.accountId &&
    (
      (input.destinationAccountId != null && item.destinationFinwiseAccountId === input.destinationAccountId) ||
      (item.counterpartyKey != null && item.counterpartyKey === input.counterpartyKey)
    ),
  );
  if (!account && !destination && !relationship) return null;
  return {
    source_account: account
      ? { role: account.role, owner_scope: account.ownerScope, context: account.context }
      : null,
    destination_account: destination
      ? { role: destination.role, owner_scope: destination.ownerScope, context: destination.context }
      : null,
    relationship_context: relationship?.context ?? null,
  };
}
