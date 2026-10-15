"use client"

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { redactInsightUrl } from "@/lib/insights"

function redactPageView(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = redactInsightUrl(event.url)
  if (!url) return null
  return { ...event, url }
}

export function Insights() {
  return (
    <>
      <Analytics beforeSend={redactPageView} />
      <SpeedInsights
        beforeSend={(event) => {
          const url = redactInsightUrl(event.url)
          if (!url) return null
          if (!event.route) return { ...event, url }
          const route = redactInsightUrl(event.route)
          if (!route) return null
          return { ...event, url, route }
        }}
      />
    </>
  )
}
