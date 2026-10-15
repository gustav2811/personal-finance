import { UtilitiesView } from "@/features/utilities/utilities-view"

export default async function UtilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { tab } = await searchParams
  const initialTab = tab === "wallet" || tab === "water" ? tab : "electricity"
  return <UtilitiesView initialTab={initialTab} />
}
