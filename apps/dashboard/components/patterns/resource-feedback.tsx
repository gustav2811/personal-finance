"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** Neutral read feedback. Features own retained-data and action policies. */
export function ResourceFeedback({ resource, title = "Household data could not be loaded", loading = "Loading household data…", saved = false, detail }: {
  resource: { status: string; hasData: boolean; reload: () => Promise<void> }
  title?: string
  loading?: string
  saved?: boolean
  detail?: string
}) {
  if (resource.status === "idle" || resource.status === "ready") return null
  if (resource.status !== "error") {
    return <p className="type-body-small text-muted-foreground" role="status" aria-busy="true">{resource.status === "refreshing" ? "Updating…" : loading}</p>
  }
  return (
    <Alert>
      <AlertTitle>{saved ? "Saved, but the latest information couldn’t be loaded" : title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{detail ?? (resource.hasData ? "Couldn’t update. Showing the last loaded information." : "Please try again.")}</p>
        <Button onClick={() => void resource.reload()} size="sm" variant="outline">Retry</Button>
      </AlertDescription>
    </Alert>
  )
}
