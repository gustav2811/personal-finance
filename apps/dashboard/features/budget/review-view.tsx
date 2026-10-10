"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { copy } from "@/domain/budget/copy"
import { currentCycle, formatDayMonth } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import {
  oneFormPerSource,
  projectReviewQueue,
  reviewFunds,
  type ReviewFund,
  type ReviewQueue,
} from "@/domain/budget/review"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readCutover as parseCutover } from "@/domain/budget/cutover"
import { readMemberDirectory } from "./members"
import { PurchaseReview } from "./purchase-review"
import { readCutover, readOverview, readReviewQueue } from "./rpc"

const PAGE_CAP = 20

type CategoryOption = {
  id: string
  name: string
}

type Ready = {
  queue: ReviewQueue
  funds: ReviewFund[]
  categories: CategoryOption[]
  members: MemberRef[]
}

function dayLabel(iso: string | null): string | null {
  if (!iso) return null
  try {
    return formatDayMonth(iso)
  } catch {
    return null
  }
}

function thrownMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.length > 0 ? caught.message : fallback
}

async function readCategories(): Promise<CategoryOption[]> {
  return parseCutover(await readCutover()).categories.map((category) => ({
    id: category.id,
    name: category.name,
  }))
}

async function readQueuePages(): Promise<{ items: unknown[]; reasons: unknown; partial: boolean }> {
  const items: unknown[] = []
  let reasons: unknown = []
  let cursor: string | null = null
  const seen = new Set<string>()
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const data = await readReviewQueue(cursor)
    const record = readRecord(data)
    if (page === 0) reasons = record?.reasons
    const pageItems = Array.isArray(record?.items) ? record.items : readArray(record?.entries)
    items.push(...pageItems)
    const next = record ? readString(record, "next_cursor") : null
    if (!next) return { items, reasons, partial: false }
    if (seen.has(next)) return { items, reasons, partial: true }
    seen.add(next)
    cursor = next
  }
  return { items, reasons, partial: true }
}

function projectPages(
  pages: { items: unknown[]; reasons: unknown; partial: boolean },
  members: readonly MemberRef[],
): ReviewQueue {
  return projectReviewQueue({
    queue: { items: pages.items, reasons: pages.reasons },
    members,
    partial: pages.partial,
  })
}

export function ReviewView() {
  const [ready, setReady] = useState<Ready | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([readQueuePages(), readOverview(currentCycle().start), readCategories(), readMemberDirectory()])
      .then(([pages, overview, categories, members]) => {
        if (cancelled) return
        setReady({
          queue: projectPages(pages, members),
          funds: reviewFunds(overview),
          categories,
          members,
        })
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(thrownMessage(caught, copy.couldNotRead))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reloadQueue() {
    if (!ready) return
    try {
      const pages = await readQueuePages()
      setReady({ ...ready, queue: projectPages(pages, ready.members) })
    } catch (caught: unknown) {
      setError(thrownMessage(caught, copy.couldNotRead))
    }
  }

  return (
    <div className="@container/budget space-y-10">
      <PageHeader description={copy.purchasesDetail} title={copy.reviewPurchases} />
      {error ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!ready && !error ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {ready ? (
        <ReviewList
          categories={ready.categories}
          funds={ready.funds}
          members={ready.members}
          onSaved={reloadQueue}
          queue={ready.queue}
        />
      ) : null}
    </div>
  )
}

function ReviewList({
  categories,
  funds,
  members,
  onSaved,
  queue,
}: {
  categories: CategoryOption[]
  funds: ReviewFund[]
  members: MemberRef[]
  onSaved: () => Promise<void>
  queue: ReviewQueue
}) {
  return (
    <Section description={copy.purchasesDetail} title={copy.purchases}>
      {queue.partial ? <p className="type-caption text-muted-foreground">{copy.partialList}</p> : null}
      {queue.reasons.length > 0 ? (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {queue.reasons.map((reason) => (
                <li key={reason.code}>{reason.sentence}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {queue.items.length === 0 ? null : (
        <ul className="divide-y rounded-lg border">
          {oneFormPerSource(queue.items).map((item) => (
            <li className="space-y-3 px-4 py-3" key={item.reviewKey}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  {dayLabel(item.occurredOn) ? (
                    <p className="type-caption text-muted-foreground">{dayLabel(item.occurredOn)}</p>
                  ) : null}
                  {item.reasons.length > 0 ? (
                    <ul className="space-y-1">
                      {item.reasons.map((reason, index) => (
                        <li key={`${reason.code}:${index}`}>{reason.sentence}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.provisional ? <p className="type-caption text-muted-foreground">Provisional. Not a confirmed balance.</p> : null}
                  {item.excluded ? <p className="type-caption text-muted-foreground">{item.excluded}</p> : null}
                  {item.payerSentence ? <p>{item.payerSentence}</p> : null}
                </div>
                <span className="type-numeric">{item.amount}</span>
              </div>
              {item.unresolved ? (
                <Alert>
                  <AlertDescription>{item.unresolved}</AlertDescription>
                </Alert>
              ) : null}
              {item.submittable && item.sourceAmountCents && item.fingerprint ? (
                <PurchaseReview
                  amountCents={item.sourceAmountCents}
                  categories={categories}
                  drifted={item.drifted}
                  fingerprint={item.fingerprint}
                  funds={funds}
                  members={members}
                  onSaved={onSaved}
                  setId={item.setId}
                  siblingCount={item.siblingCount}
                  sourceTransactionId={item.sourceTransactionId}
                  utilityEntryId={item.utilityEntryId}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
