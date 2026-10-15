"use client"

import Link from "next/link"
import { useCallback } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ResourceFeedback } from "./read-feedback"
import { useResource } from "@/hooks/use-resource"
import { copy } from "@/domain/budget/copy"
import type { MemberRef } from "@/domain/budget/members"
import { alreadyApproved, projectReviewQueue, reviewFunds, type RefundablePurchase, type ReviewFund } from "@/domain/budget/review"
import { readSavedReview } from "@/domain/budget/v1"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readMemberDirectory } from "./members"
import { AlreadyApproved, PurchaseReview } from "./purchase-review"
import { loadRefundablePurchases } from "./purchases"
import { readCutover, readOverview, readReviewQueue, readSourceReview } from "./rpc"
import { currentCycle } from "@/domain/budget/cycle"

export type TransactionBudgetReady = {
  ask: boolean
  sentence: string
  amountCents: string | null
  fingerprint: string | null
  setId: string | null
  siblingCount: number
  drifted: boolean
  funds: ReviewFund[]
  members: MemberRef[]
  categories: Array<{ id: string; name: string }>
  purchases: RefundablePurchase[]
  purchasesPartial: boolean
  purchasesUnread: boolean
  decisionsConfirmed: boolean
  queuePartial: boolean
  savedReviewReadFailed: boolean
}

const QUEUE_PAGE_CAP = 20

function readQueuePageEntries(page: unknown): unknown[] {
  const record = readRecord(page)
  return Array.isArray(record?.items) ? record.items : readArray(record?.entries)
}

export async function readReviewQueuePages(
  readPage: (cursor: string | null) => Promise<unknown> = readReviewQueue,
): Promise<{ queue: unknown; partial: boolean }> {
  const pages: unknown[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  let partial = false
  for (let page = 0; page < QUEUE_PAGE_CAP; page += 1) {
    const result = await readPage(cursor)
    pages.push(result)
    const record = readRecord(result)
    const next = record ? readString(record, "next_cursor") : null
    if (!next || seen.has(next)) {
      partial = next !== null
      break
    }
    seen.add(next)
    cursor = next
    if (page === QUEUE_PAGE_CAP - 1) partial = true
  }
  const first = readRecord(pages[0])
  if (!first) return { queue: pages[0] ?? null, partial }
  const entries = pages.flatMap(readQueuePageEntries)
  return { queue: { ...first, items: entries, entries, next_cursor: null }, partial }
}

async function loadTransactionBudget(transactionId: string): Promise<TransactionBudgetReady> {
  const [queueResult, overviewResult, cutoverResult, membersResult, savedResult] = await Promise.allSettled([
    readReviewQueuePages(),
    readOverview(currentCycle().start),
    readCutover(),
    readMemberDirectory(),
    readSourceReview(transactionId),
  ])
  const failure = [queueResult, overviewResult, cutoverResult, membersResult].find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason instanceof Error ? failure.reason : new Error("Budget review could not be loaded.")
  if (queueResult.status !== "fulfilled" || overviewResult.status !== "fulfilled" || cutoverResult.status !== "fulfilled" || membersResult.status !== "fulfilled") {
    throw new Error("Budget review could not be loaded.")
  }
  const queue = queueResult.value
  const overview = overviewResult.value
  const cutover = cutoverResult.value
  const members = membersResult.value
  const savedReviewReadFailed = savedResult.status === "rejected"
  const saved = savedResult.status === "fulfilled" ? savedResult.value : null
  const projected = projectReviewQueue({ queue: queue.queue, members, partial: queue.partial })
  const item = projected.items.find((entry) => entry.sourceTransactionId === transactionId) ?? null
  const drifted = item?.drifted === true
  const categories = readArray(readRecord(cutover)?.categories).flatMap((entry) => {
    const record = readRecord(entry)
    const id = record ? readString(record, "id") : null
    const name = record ? readString(record, "name") : null
    return id && name ? [{ id, name }] : []
  })
  const funds = reviewFunds(overview)
  const purchases = await loadRefundablePurchases({ funds, members }).catch(() => ({
    purchases: [],
    partial: false,
    unread: true,
  }))
  const savedReview = saved ? readSavedReview(saved, members) : null
  const payer = item?.payerSentence
  return {
    ask: !alreadyApproved({ inQueue: item !== null, status: savedReview?.status ?? (item ? "needs_review" : null), drifted }),
    sentence: savedReview?.found ? [savedReview.sentence, ...savedReview.trail].join(" ") : (payer ?? copy.purchase),
    amountCents: item?.sourceAmountCents ?? null,
    fingerprint: item?.fingerprint ?? null,
    setId: item?.setId ?? null,
    siblingCount: item?.siblingCount ?? 1,
    drifted,
    funds,
    members,
    categories,
    purchases: purchases.purchases,
    purchasesPartial: purchases.partial,
    purchasesUnread: purchases.unread,
    decisionsConfirmed: item?.decisionsConfirmed ?? false,
    queuePartial: projected.partial,
    savedReviewReadFailed,
  }
}

export function TransactionBudget({ transactionId, load: loadOverride }: {
  transactionId: string
  load?: (transactionId: string) => Promise<TransactionBudgetReady>
}) {
  const load = useCallback(() => (loadOverride ?? loadTransactionBudget)(transactionId), [loadOverride, transactionId])
  const resource = useResource({ key: `transaction-budget:${transactionId}`, load })
  if (resource.status === "loading" || resource.status === "idle" || resource.status === "error") {
    return <ResourceFeedback resource={resource} title="Budget review could not be loaded" loading="Loading budget review…" />
  }
  const ready = resource.data
  if (!ready) return null
  if (ready.savedReviewReadFailed) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Saved budget review could not be checked</AlertTitle>
        <AlertDescription>
          <span>Review status is unknown, so this transaction cannot be approved safely.</span>
          <Button className="mt-2" onClick={() => void resource.reload()} size="sm" variant="outline">Retry</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (ready.queuePartial) {
    return (
      <Alert>
        <AlertTitle>Budget review is incomplete</AlertTitle>
        <AlertDescription>
          <span>Only part of the review queue was read, so sibling decisions may be missing. Approval is paused until the full queue is available.</span>
          <Button className="mt-2" onClick={() => void resource.reload()} size="sm" variant="outline">Retry</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!ready.ask) return <AlreadyApproved sentence={ready.sentence} />
  if (!ready.amountCents || !ready.fingerprint) {
    return (
      <Alert>
        <AlertTitle>Budget review needs source details</AlertTitle>
        <AlertDescription>
          <span>The amount or source fingerprint is incomplete, so this transaction cannot be approved yet.</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => void resource.reload()} size="sm" variant="outline">Retry</Button>
            <Button asChild size="sm" variant="ghost"><Link href="/budget/review">Open budget review</Link></Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="space-y-2">
      <PurchaseReview
      amountCents={ready.amountCents}
      categories={ready.categories}
      decisionsConfirmed={ready.decisionsConfirmed}
      drifted={ready.drifted}
      fingerprint={ready.fingerprint}
      funds={ready.funds}
      members={ready.members}
      onSaved={() => resource.reload()}
      purchases={ready.purchases}
      purchasesPartial={ready.purchasesPartial}
      purchasesUnread={ready.purchasesUnread}
      setId={ready.setId}
      siblingCount={ready.siblingCount}
      sourceTransactionId={transactionId}
      />
    </div>
  )
}
