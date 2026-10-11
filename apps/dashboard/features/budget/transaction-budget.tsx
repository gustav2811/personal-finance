"use client"

import { useEffect, useState } from "react"
import { copy } from "@/domain/budget/copy"
import type { MemberRef } from "@/domain/budget/members"
import { alreadyApproved, projectReviewQueue, reviewFunds, type ReviewFund } from "@/domain/budget/review"
import { readSavedReview } from "@/domain/budget/v1"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readMemberDirectory } from "./members"
import { AlreadyApproved, PurchaseReview } from "./purchase-review"
import { readCutover, readOverview, readReviewQueue, readSourceReview } from "./rpc"
import { currentCycle } from "@/domain/budget/cycle"

type Ready = {
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
}

export function TransactionBudget({ transactionId }: { transactionId: string }) {
  const [ready, setReady] = useState<Ready | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      readReviewQueue(null),
      readOverview(currentCycle().start),
      readCutover(),
      readMemberDirectory(),
      readSourceReview(transactionId).catch(() => null),
    ])
      .then(([queue, overview, cutover, members, saved]) => {
        if (cancelled) return
        const projected = projectReviewQueue({ queue, members })
        const item = projected.items.find((entry) => entry.sourceTransactionId === transactionId) ?? null
        const drifted = item?.drifted === true
        const categories = readArray(readRecord(cutover)?.categories).flatMap((entry) => {
          const record = readRecord(entry)
          const id = record ? readString(record, "id") : null
          const name = record ? readString(record, "name") : null
          return id && name ? [{ id, name }] : []
        })
        const savedReview = saved ? readSavedReview(saved, members) : null
        const payer = item?.payerSentence
        setReady({
          ask: !alreadyApproved({ inQueue: item !== null, status: savedReview?.status ?? (item ? "needs_review" : null), drifted }),
          sentence: savedReview?.found ? [savedReview.sentence, ...savedReview.trail].join(" ") : (payer ?? copy.purchase),
          amountCents: item?.sourceAmountCents ?? null,
          fingerprint: item?.fingerprint ?? null,
          setId: item?.setId ?? null,
          siblingCount: item?.siblingCount ?? 1,
          drifted,
          funds: reviewFunds(overview),
          members,
          categories,
        })
      })
      .catch(() => {
        if (!cancelled) setReady(null)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, transactionId])

  if (!ready) return null
  if (!ready.ask && !ready.amountCents) return null
  if (!ready.ask) return <AlreadyApproved sentence={ready.sentence} />
  if (!ready.amountCents || !ready.fingerprint) return <p className="type-caption text-muted-foreground">{copy.somethingUnresolved}</p>
  return (
    <PurchaseReview
      amountCents={ready.amountCents}
      categories={ready.categories}
      drifted={ready.drifted}
      fingerprint={ready.fingerprint}
      funds={ready.funds}
      members={ready.members}
      onSaved={async () => setReloadKey((key) => key + 1)}
      setId={ready.setId}
      siblingCount={ready.siblingCount}
      sourceTransactionId={transactionId}
    />
  )
}
