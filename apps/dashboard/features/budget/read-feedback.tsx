"use client"

import type { ComponentProps } from "react"
import { ResourceFeedback as Feedback } from "@/components/patterns/resource-feedback"
import { copy } from "@/domain/budget/copy"

/** Keep actionable household messages, without displaying arbitrary RPC diagnostics. */
export function ResourceFeedback({ resource, ...props }: ComponentProps<typeof Feedback> & { resource: { error?: unknown } }) {
  const message = resource.error instanceof Error ? resource.error.message : null
  const detail = message === copy.notAMember || message === copy.signIn || message === copy.numbersChanged ? message : undefined
  return <Feedback {...props} resource={resource} detail={detail} />
}
