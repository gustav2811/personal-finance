"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useHousehold } from "@/components/app/household-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import {
  fetchDashboardData,
  fetchDashboardDataFromLocalBridge,
  type DashboardData,
  type DashboardScope,
} from "@/lib/data"

export function DataGate({
  children,
  scope,
}: {
  children: (data: DashboardData) => ReactNode
  scope: DashboardScope
}) {
  const { isLocalPreview } = useHousehold()
  const [data, setData] = useState<DashboardData | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setDataError(null)
    const load = isLocalPreview
      ? fetchDashboardDataFromLocalBridge(scope)
      : fetchDashboardData(scope)
    void load
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
  }, [isLocalPreview, scope])

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
