import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

/** A consistent no-data footprint for a chart; fetching and errors belong to the feature. */
export function ChartEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <Empty className="min-h-48 border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  )
}
