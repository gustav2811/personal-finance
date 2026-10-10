"use client"

import { useEffect, useState } from "react"
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
import { projectFund, type FundMoney, type FundView as FundDetail } from "@/domain/budget/fund"
import type { MemberRef } from "@/domain/budget/members"
import { TargetBar } from "@/domain/budget/target-bar"
import { readMemberDirectory } from "./members"
import { readFund } from "./rpc"

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
        <TargetBar
          funded={view.target.funded}
          fundedCents={view.target.fundedCents}
          fundedLabel={view.target.funded === view.available.amount ? copy.available : ""}
          suggestion={view.suggestion !== null}
          target={view.target.target}
          targetCents={view.target.targetCents}
        />
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
                  <TableCell>{entry.sentence}</TableCell>
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
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cycle = currentCycle()
    void Promise.all([readFund(fundId, FUND_HISTORY_FROM, cycle.endExclusive, null), readMemberDirectory()])
      .then(([nextWire, nextMembers]) => {
        if (cancelled) return
        setWire(nextWire)
        setMembers(nextMembers)
        setReady(true)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : copy.couldNotRead)
      })
    return () => {
      cancelled = true
    }
  }, [fundId])

  const view = ready ? projectFund(wire, members) : null
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
