"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  const [data, setData] = useState<T | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setDataError(null)
    void load()
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch(() => {
        if (!cancelled) {
          setDataError(
            "Household data could not be read. Check the Supabase schema exposure and read policies.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [load])

  if (dataError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Household data is unavailable</AlertTitle>
        <AlertDescription>{dataError}</AlertDescription>
      </Alert>
    )
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <span className="sr-only">Loading household data</span>
      </div>
    )
  }

  return children(data)
}
