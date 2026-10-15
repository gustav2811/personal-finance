"use client"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { ResourceFeedback } from "@/components/patterns/resource-feedback"
import { Section } from "@/components/patterns/section"
import { useResource } from "@/hooks/use-resource"

/** Local fixtures only: no RPCs, source records, or financial commands. */
export function ResourceExamples() {
  const failNext = useRef(false)
  const load = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (failNext.current) { failNext.current = false; throw new Error("Illustrative failure") }
    return "R780"
  }, [])
  const resource = useResource({ key: "illustrative-wallet", load, retainData: true })
  return (
    <Section title="Data lifecycle" description="Illustrative amount. Simulate a failed refresh, then Retry. The previous answer stays visible and financial actions wait for a fresh read.">
      <ResourceFeedback resource={resource} title="Illustrative wallet could not be loaded" />
      {resource.hasData ? <p className="type-body">Last loaded cost: <span className="type-numeric">{resource.data}</span></p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={resource.status !== "ready"} onClick={() => { failNext.current = true; void resource.reload() }} size="sm" variant="outline">Simulate failed refresh</Button>
        <Button disabled={resource.status !== "ready"} size="sm" variant="outline">Illustrative financial action</Button>
      </div>
    </Section>
  )
}
