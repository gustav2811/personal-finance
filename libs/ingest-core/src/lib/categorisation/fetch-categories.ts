import type { FinWiseClient, TransactionCategory } from "@investments/finwise";

const PAGE_SIZE = 100;

/**
 * List all transaction categories (one FinWise subrequest per page).
 */
export async function fetchAllTransactionCategories(
  finwise: FinWiseClient,
): Promise<TransactionCategory[]> {
  const out: TransactionCategory[] = [];
  let pageNumber = 1;
  for (;;) {
    const page = await finwise.transactionCategories.list({
      pagination: { pageNumber, pageSize: PAGE_SIZE },
    });
    if (!page.length) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    pageNumber += 1;
  }
  return out;
}

export function categoriesToNameIdMap(
  categories: TransactionCategory[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of categories) {
    if (c.name && c.id) m.set(c.name, c.id);
  }
  return m;
}

export function categoriesToIdNameMap(
  categories: TransactionCategory[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of categories) {
    if (c.id && c.name) m.set(c.id, c.name);
  }
  return m;
}
