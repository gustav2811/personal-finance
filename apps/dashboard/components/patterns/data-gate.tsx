"use client"

import { type ReactNode } from "react"
import { useResource } from "@/hooks/use-resource"
import { ResourceFeedback } from "./resource-feedback"
import { Skeleton } from "@/components/ui/skeleton"

// `load` is a dependency. Pass a stable function (module-level or useCallback).
// An inline `load` refetches on every render.
export function DataGate<T>({
  children,
  load,
}: {
  children: (data: T) => ReactNode
  load: () => Promise<T>
}) {
  const resource = useResource({ key: "data-gate", load })
  if (resource.status === "error") return <ResourceFeedback resource={resource} />

  if (!resource.hasData) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <span className="sr-only">Loading household data</span>
      </div>
    )
  }

  return children(resource.data as T)
}
