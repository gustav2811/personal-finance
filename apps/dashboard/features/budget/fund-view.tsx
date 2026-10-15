"use client"

import { useCallback } from "react"
import Link from "next/link"
import { FactGrid } from "@/components/patterns/fact-grid"
import { PageHeader } from "@/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ResourceFeedback } from "./read-feedback"
import { useResource } from "@/hooks/use-resource"
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
import { projectFund, type FundView as FundDetail } from "@/domain/budget/fund"
import type { MemberRef } from "@/domain/budget/members"
import { FundLine } from "@/domain/budget/fund-line"
import { TargetBar } from "@/domain/budget/target-bar"
import { readMemberDirectory } from "./members"
import { readCutover as readCutoverRpc, readFund } from "./rpc"

const FUND_HISTORY_FROM = "2020-01-01"

function FundBody({ view }: { view: FundDetail }) {
  const facts = [view.available, view.ledger, view.assigned, view.restricted, view.suggestion].flatMap((fact) =>
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

      <FactGrid columns={2} items={facts.map((fact) => ({
        label: fact.label,
        value: fact.amount,
        detail: fact.caption,
        tone: fact.amount.startsWith(copy.deficit) ? "warning" : "default",
      }))} />

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
      {view.points.length > 1 ? <FundLine points={view.points} /> : null}
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
  const load = useCallback(async (_signal: AbortSignal) => {
    const cycle = currentCycle()
    const [wire, members, cutoverWire] = await Promise.all([
      readFund(fundId, FUND_HISTORY_FROM, cycle.endExclusive, null),
      readMemberDirectory(),
      readCutoverRpc(),
    ])
    const cutover = readCutover(cutoverWire)
    return {
      wire,
      members,
      context: {
        earmarks: cutover.earmarks,
        accountNames: new Map(cutover.accounts.map((account) => [account.id, account.name])),
      },
    }
  }, [fundId])
  const resource = useResource({ key: `fund:${fundId}`, load, retainData: false })
  const loaded = resource.data
  const view = loaded ? projectFund(loaded.wire, loaded.members, { fundId, ...loaded.context }) : null
  const title = view?.name ?? "Purpose"

  return (
    <div className="@container/fund space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: title }]}
        title={title}
      />
      <ResourceFeedback resource={resource} title="Fund data could not be loaded" loading="Reading the budget…" />
      {view ? <FundBody view={view} /> : null}
    </div>
  )
}
