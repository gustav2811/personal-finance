"use client"

import { useCallback, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { ResourceFeedback } from "./read-feedback"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useResource } from "@/hooks/use-resource"
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
import { loadRefundablePurchases, type PurchaseList } from "./purchases"
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
  purchases: PurchaseList
}

function dayLabel(iso: string | null): string | null {
  if (!iso) return null
  try {
    return formatDayMonth(iso)
  } catch {
    return null
  }
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
  const [saved, setSaved] = useState(false)
  const load = useCallback(async (_signal: AbortSignal): Promise<Ready> => {
    const [pages, overview, categories, members] = await Promise.all([
      readQueuePages(),
      readOverview(currentCycle().start),
      readCategories(),
      readMemberDirectory(),
    ])
    const funds = reviewFunds(overview)
    const purchases = await loadRefundablePurchases({ funds, members }).catch(() => ({
      purchases: [],
      partial: false,
      unread: true,
    }))
    return { queue: projectPages(pages, members), funds, categories, members, purchases }
  }, [])
  const resource = useResource({ key: "budget:review", load, retainData: true })
  const ready = resource.hasData ? resource.data : null
  const reloadQueue = useCallback(async () => {
    setSaved(true)
    await resource.reload()
  }, [resource.reload])

  return (
    <div className="@container/budget space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: copy.decide }]}
        description={copy.theseChangeAnswers}
        title={copy.attentionQuestion}
      />
      <ResourceFeedback resource={resource} title="Budget review could not be loaded" loading="Reading the budget…" saved={saved} />
      {ready ? (
        <ReviewList
          categories={ready.categories}
          funds={ready.funds}
          members={ready.members}
          onSaved={reloadQueue}
          purchases={ready.purchases}
          queue={ready.queue}
          actionsReady={resource.status === "ready"}
        />
      ) : null}
    </div>
  )
}

export function ReviewList({
  categories,
  funds,
  members,
  onSaved,
  purchases,
  queue,
  actionsReady,
}: {
  categories: CategoryOption[]
  funds: ReviewFund[]
  members: MemberRef[]
  onSaved: () => Promise<void>
  purchases: PurchaseList
  queue: ReviewQueue
  actionsReady: boolean
}) {
  return (
    <Section description={copy.purchasesDetail} title={copy.attentionQuestion}>
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
                    <p>{[...new Set(item.reasons.map((reason) => reason.sentence))].join(" ")}</p>
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
                <fieldset disabled={!actionsReady} className="min-w-0 disabled:opacity-70">
                  <PurchaseReview
                    amountCents={item.sourceAmountCents}
                    categories={categories}
                    decisionsConfirmed={item.decisionsConfirmed}
                    drifted={item.drifted}
                    fingerprint={item.fingerprint}
                    fundId={item.fundId}
                    funds={funds}
                    members={members}
                    onSaved={onSaved}
                    purchases={purchases.purchases}
                    purchasesPartial={purchases.partial}
                    purchasesUnread={purchases.unread}
                    setId={item.setId}
                    siblingCount={item.siblingCount}
                    sourceTransactionId={item.sourceTransactionId}
                    utilityEntryId={item.utilityEntryId}
                  />
                </fieldset>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
