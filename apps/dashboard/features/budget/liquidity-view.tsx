"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
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
import { formatDayMonth } from "@/domain/budget/cycle"
import { projectLiquidity, type LiquidityAmount, type LiquidityProjection } from "@/domain/budget/liquidity"
import type { MemberRef } from "@/domain/budget/members"
import { readMemberDirectory } from "./members"
import { readLiquidity } from "./rpc"

function shownAmount(amount: string | null): string {
  return amount ?? copy.needsReconciliation
}

function shownDate(value: string | null): string {
  if (!value) return copy.withheld
  return formatDayMonth(value)
}

function Fact({ fact }: { fact: LiquidityAmount }) {
  return (
    <div className="space-y-1 bg-card px-4 py-3">
      <p className="type-label text-muted-foreground">{fact.label}</p>
      <p className="type-numeric text-2xl font-semibold tracking-tight">{shownAmount(fact.amount)}</p>
      <p className="type-caption text-muted-foreground">{fact.caption}</p>
    </div>
  )
}

export function LiquidityView() {
  const [wire, setWire] = useState<unknown>(undefined)
  const [members, setMembers] = useState<MemberRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([readLiquidity(), readMemberDirectory()])
      .then(([nextWire, nextMembers]) => {
        if (!cancelled) {
          setWire(nextWire)
          setMembers(nextMembers)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : copy.couldNotRead)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const view = members !== null ? projectLiquidity(wire, members) : null

  return (
    <div className="@container/liquidity space-y-10">
      <PageHeader
        breadcrumbs={[
          { href: "/budget", label: copy.pageTitle },
          { label: copy.liquidity },
        ]}
        description={copy.liquidityDetail}
        title={copy.liquidity}
      />
      {error ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!view && !error ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {view ? <LiquidityBody view={view} /> : null}
    </div>
  )
}

function LiquidityBody({ view }: { view: LiquidityProjection }) {
  const uncertainty = view.uncertainty.filter((sentence) => sentence !== copy.notStatementForecast)
  return (
    <>
      {view.complete ? null : (
        <Alert>
          <AlertTitle>{view.headline}</AlertTitle>
          <AlertDescription>
            <p>{view.detail}</p>
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

      <Section description={copy.liquidityDetail} title={copy.liquidity}>
        {view.accounts.length === 0 ? (
          <p className="type-body text-muted-foreground">
            {view.complete ? copy.noReconciledAccounts : copy.needsReconciliation}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">{copy.liquidity}</span>
                </TableHead>
                <TableHead className="text-right">{copy.liquidity}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <p>{account.owner}</p>
                    {account.note ? <p className="type-caption text-muted-foreground">{account.note}</p> : null}
                  </TableCell>
                  <TableCell className="type-numeric text-right">{shownAmount(account.cash)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="type-caption text-muted-foreground">
          {copy.cardDebt}: <span className="type-numeric text-foreground">{shownAmount(view.cardDebt.amount)}</span>
          . {copy.cardDebtDetail}
        </p>
      </Section>

      <Section description={copy.forecastDetail} title={copy.forecast}>
        <dl className="grid gap-px overflow-hidden rounded-lg border bg-border @3xl/liquidity:grid-cols-3">
          <Fact fact={view.expectedIncome} />
          <Fact fact={view.expectedPayments} />
          <Fact fact={view.gap} />
        </dl>
        {view.gap.caption.includes(copy.notStatementForecast) ? (
          <p className="type-caption text-muted-foreground">{copy.notStatementForecast}</p>
        ) : null}
        {uncertainty.length > 0 ? (
          <ul className="type-caption list-disc pl-4 text-muted-foreground">
            {uncertainty.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        ) : null}
        {view.entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>{copy.forecast}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{copy.forecast}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.entries.map((entry, index) => (
                <TableRow key={`${entry.label}:${entry.date ?? ""}:${index}`}>
                  <TableCell>{shownDate(entry.date)}</TableCell>
                  <TableCell>{entry.label}</TableCell>
                  <TableCell className="type-numeric text-right">{shownAmount(entry.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Section>

      <Section description={copy.moveCashDetail} title={copy.moveCash} />
    </>
  )
}
