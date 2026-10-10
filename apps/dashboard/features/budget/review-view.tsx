"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildReviewPayload, newCommandId } from "@/domain/budget/commands"
import { copy } from "@/domain/budget/copy"
import { currentCycle, formatDayMonth } from "@/domain/budget/cycle"
import { memberName, type MemberRef } from "@/domain/budget/members"
import {
  projectReviewQueue,
  reviewFunds,
  type ReviewFund,
  type ReviewItem,
  type ReviewQueue,
} from "@/domain/budget/review"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { getBrowserClient } from "@/lib/supabase/browser"
import { readOverview, readReviewQueue, writeBudgetRpc } from "./rpc"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"
const PAGE_CAP = 20

type WhoseExpense = { kind: "shared" } | { kind: "member"; memberId: string }

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
  const { data, error } = await getBrowserClient()
    .schema("finance")
    .from("categories")
    .select("id, name, archived_at")
  if (error || !data) throw new Error(copy.couldNotRead)
  return data.flatMap((row) =>
    row.archived_at === null && row.name.length > 0 ? [{ id: row.id, name: row.name }] : [],
  )
}

async function readMembers(): Promise<MemberRef[]> {
  const { data, error } = await getBrowserClient()
    .schema("finance")
    .from("household_members")
    .select("id, email")
  if (error || !data) throw new Error(copy.couldNotRead)
  return data.flatMap((row) => (row.id ? [{ id: row.id, email: row.email }] : []))
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
    void Promise.all([readQueuePages(), readOverview(currentCycle().start), readCategories(), readMembers()])
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
      <PageHeader description={copy.purchasesDetail} title={copy.pageTitle} />
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
          {queue.items.map((item) => (
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
                  {item.payerSentence ? <p>{item.payerSentence}</p> : null}
                </div>
                <span className="type-numeric">{item.amount}</span>
              </div>
              {item.unresolved ? (
                <Alert>
                  <AlertDescription>{item.unresolved}</AlertDescription>
                </Alert>
              ) : null}
              {item.submittable ? (
                <ReviewDecision
                  categories={categories}
                  funds={funds}
                  item={item}
                  members={members}
                  onSaved={onSaved}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function ReviewDecision({
  categories,
  funds,
  item,
  members,
  onSaved,
}: {
  categories: CategoryOption[]
  funds: ReviewFund[]
  item: ReviewItem
  members: MemberRef[]
  onSaved: () => Promise<void>
}) {
  const [whose, setWhose] = useState<WhoseExpense | null>(null)
  const [fundId, setFundId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const whoseValue = whose?.kind === "member" ? whose.memberId : whose?.kind
  const canSave = Boolean(whose && fundId && categoryId && item.amountCents && item.fingerprint && item.sourceTransactionId)

  async function save() {
    if (!whose || !fundId || !categoryId || !item.amountCents || !item.fingerprint || !item.sourceTransactionId) return
    setSaving(true)
    setError(null)
    try {
      await writeBudgetRpc(
        "budget_review_allocation_v1",
        newCommandId(),
        buildReviewPayload({
          transactionId: item.sourceTransactionId,
          expectedSourceFingerprint: item.fingerprint,
          expectedCurrentSetId: item.setId ?? undefined,
          components: [
            {
              amountCents: item.amountCents,
              beneficiaryScope: whose.kind,
              beneficiaryMemberId: whose.kind === "member" ? whose.memberId : undefined,
              effectKind: "consumption",
              fundId,
              categoryId,
            },
          ],
          decisionUpdate: {
            categoryId,
            isTransfer: false,
            excludeFromSpend: false,
          },
        }),
      )
      await onSaved()
    } catch (caught: unknown) {
      setError(thrownMessage(caught, copy.couldNotSave))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{copy.whoseExpense}</p>
          <ToggleGroup
            aria-label={copy.whoseExpense}
            onValueChange={(next) => {
              if (next === "shared") setWhose({ kind: "shared" })
              else if (next) setWhose({ kind: "member", memberId: next })
            }}
            size="sm"
            spacing={0}
            type="single"
            value={whoseValue}
            variant="outline"
          >
            <ToggleGroupItem className={TOUCH} value="shared">
              {copy.shared}
            </ToggleGroupItem>
            {members.map((member) => (
              <ToggleGroupItem className={TOUCH} key={member.id} value={member.id}>
                {memberName(members, member.id)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{copy.purposes}</p>
          <Select
            onValueChange={(next) => {
              if (next) setFundId(next)
            }}
            value={fundId ?? undefined}
          >
            <SelectTrigger aria-label={copy.purposes} className="pointer-coarse:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {funds.map((fund) => (
                <SelectItem key={fund.id} value={fund.id}>
                  {fund.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">Category</p>
          <Select
            onValueChange={(next) => {
              if (next) setCategoryId(next)
            }}
            value={categoryId ?? undefined}
          >
            <SelectTrigger aria-label="Category" className="pointer-coarse:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="pointer-coarse:h-9" disabled={!canSave || saving} onClick={() => void save()} type="button">
          Save
        </Button>
      </div>
      {error ? (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
