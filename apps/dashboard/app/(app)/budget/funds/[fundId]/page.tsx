import { FundView } from "@/features/budget/fund-view"

export default async function FundPage({
  params,
}: {
  params: Promise<{ fundId: string }>
}) {
  const { fundId } = await params
  return <FundView fundId={fundId} />
}
