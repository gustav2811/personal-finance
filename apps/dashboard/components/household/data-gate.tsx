"use client"

import type { ReactNode } from "react"
import { useHousehold } from "@/components/app/household-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { DashboardData } from "@/lib/data"

export function DataGate({
  children,
}: {
  children: (data: DashboardData) => ReactNode
}) {
  const { data, dataError } = useHousehold()

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

  if (
    data.devices.length === 0 &&
    data.readings.length === 0 &&
    data.ledgerEntries.length === 0
  ) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Nothing connected yet</EmptyTitle>
          <EmptyDescription>
            Readings and ledger rows will appear here once a source has written them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return children(data)
}
