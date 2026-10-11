import { TransactionsView } from "@/features/transactions/transactions-view"

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ transaction?: string }>
}) {
  const params = await searchParams
  return <TransactionsView initialTransactionId={params.transaction ?? null} />
}
