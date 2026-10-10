"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { copy } from "@/domain/budget/copy"
import { currentCycle } from "@/domain/budget/cycle"
import { readCutover } from "@/domain/budget/cutover"
import { projectFund, type FundMoney, type FundView as FundDetail } from "@/domain/budget/fund"
import type { MemberRef } from "@/domain/budget/members"
import { TargetBar } from "@/domain/budget/target-bar"
import { readMemberDirectory } from "./members"
import { readCutover as readCutoverRpc, readFund } from "./rpc"

const FUND_HISTORY_FROM = "2020-01-01"

function Fact({ fact }: { fact: FundMoney }) {
  const deficit = fact.amount.startsWith(copy.deficit)
  return (
    <div className="space-y-1 bg-card px-4 py-3">
      <p className="type-label text-muted-foreground">{fact.label}</p>
      <p className={`type-numeric text-2xl font-semibold tracking-tight ${deficit ? "text-warning" : ""}`}>
        {fact.amount}
      </p>
      {fact.caption ? <p className="type-caption text-muted-foreground">{fact.caption}</p> : null}
    </div>
  )
}

function FundBody({ view }: { view: FundDetail }) {
  const facts = [view.available, view.assigned, view.restricted, view.suggestion].flatMap((fact) =>
    fact ? [fact] : [],
  )
  const shown = new Set(facts.map((fact) => fact.caption).filter((caption) => caption.length > 0))
  const notices = view.notices.filter((sentence) => !shown.has(sentence))

  return (
    <>
      {view.complete ? null : (
        <Alert>
          <AlertTitle>{view.headline}</AlertTitle>
          <AlertDescription>
            <p>{copy.needsReconciliationDetail}</p>
            {view.reasons.length > 0 ? (
              <ul className="mt-2 list-disc pl-4">
                {view.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      )}

      <p
        className={`type-numeric text-2xl font-semibold tracking-tight ${
          view.headline.startsWith(copy.deficit) ? "text-warning" : ""
        }`}
      >
        {view.headline}
      </p>
      {notices.map((sentence) => (
        <p className="type-caption text-muted-foreground" key={sentence}>
          {sentence}
        </p>
      ))}

      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border @3xl/fund:grid-cols-2">
        {facts.map((fact) => (
          <Fact fact={fact} key={fact.label} />
        ))}
      </dl>

      {view.target ? (
        <div className="space-y-2">
          <TargetBar
            funded={view.target.funded}
            fundedCents={view.target.fundedCents}
            fundedLabel={view.target.funded === view.available.amount ? copy.available : ""}
            suggestion={view.suggestion !== null}
            target={view.target.target}
            targetCents={view.target.targetCents}
          />
          {view.dueOn ? <p className="type-caption text-muted-foreground">{copy.nextNeed}: {view.dueOn}</p> : null}
        </div>
      ) : null}
      {view.holdings.length > 0 ? (
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{copy.restricted}</p>
          <ul className="space-y-1">
            {view.holdings.map((holding) => (
              <li key={`${holding.accountId}-${holding.asOf}`}>
                {holding.amount} in {holding.accountName}. As of {holding.asOf}. {copy.fundedNotAccessible}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.timeline.length > 0 ? (
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{copy.assigned}</p>
          <ul className="space-y-1">
            {view.timeline.map((point, index) => (
              <li className="type-caption" key={`${point.when}-${index}`}>
                {point.when}: contribution {point.contribution}, spending {point.spending}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.listNote ? <p className="type-caption text-muted-foreground">{view.listNote}</p> : null}
      {view.entries.length === 0 ? (
        <p className="type-body text-muted-foreground">Nothing in this view.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.whoseExpense}</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.entries.map((entry, index) => (
                <TableRow key={`${entry.when}-${entry.amount}-${entry.sentence}-${index}`}>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{entry.sentence}</p>
                      {entry.sourceTransactionId ? (
                        <Link className="type-caption underline-offset-4 hover:underline" href={`/transactions?transaction=${entry.sourceTransactionId}`}>
                          Source
                        </Link>
                      ) : null}
                      {entry.correctionOf ? <p className="type-caption text-muted-foreground">{copy.correctedSpend}</p> : null}
                    </div>
                  </TableCell>
                  <TableCell>{entry.when}</TableCell>
                  <TableCell className="type-numeric text-right">{entry.amount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

export function FundView({ fundId }: { fundId: string }) {
  const [wire, setWire] = useState<unknown>(null)
  const [members, setMembers] = useState<MemberRef[]>([])
  const [context, setContext] = useState<{
    earmarks: Array<{ fundId: string; accountId: string; amountCents: string; effectiveOn: string }>
    accountNames: Map<string, string>
  }>({ earmarks: [], accountNames: new Map() })
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cycle = currentCycle()
    void Promise.all([readFund(fundId, FUND_HISTORY_FROM, cycle.endExclusive, null), readMemberDirectory(), readCutoverRpc()])
      .then(([nextWire, nextMembers, cutoverWire]) => {
        if (cancelled) return
        const cutover = readCutover(cutoverWire)
        setWire(nextWire)
        setMembers(nextMembers)
        setContext({
          earmarks: cutover.earmarks,
          accountNames: new Map(cutover.accounts.map((account) => [account.id, account.name])),
        })
        setReady(true)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : copy.couldNotRead)
      })
    return () => {
      cancelled = true
    }
  }, [fundId])

  const view = ready ? projectFund(wire, members, { fundId, ...context }) : null
  const title = view?.name ?? "Purpose"

  return (
    <div className="@container/fund space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: title }]}
        title={title}
      />
      {error ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!view && !error ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {view ? <FundBody view={view} /> : null}
    </div>
  )
}
