"use client"

import { useResource } from "@/hooks/use-resource"
import { ResourceFeedback } from "./read-feedback"
import { FactGrid } from "@/components/patterns/fact-grid"
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
import { projectLiquidity, type LiquidityProjection } from "@/domain/budget/liquidity"
import { readMemberDirectory } from "./members"
import { readLiquidity } from "./rpc"

function shownAmount(amount: string | null): string {
  return amount ?? copy.needsReconciliation
}

function shownDate(value: string | null): string {
  if (!value) return copy.withheld
  return formatDayMonth(value)
}

async function loadLiquidity() {
  const [wire, members] = await Promise.all([readLiquidity(), readMemberDirectory()])
  return { wire, members }
}

export function LiquidityView({ load = loadLiquidity }: { load?: typeof loadLiquidity } = {}) {
  const resource = useResource({ key: "budget:liquidity", load, retainData: true })
  const view = resource.hasData ? projectLiquidity(resource.data!.wire, resource.data!.members) : null

  return (
    <div className="@container/liquidity space-y-10">
      <PageHeader
        breadcrumbs={[
          { href: "/budget", label: copy.pageTitle },
          { label: copy.liquidity },
        ]}
        description={copy.liquidityDetail}
        title={copy.cashInEachAccount}
      />
      <ResourceFeedback resource={resource} title={copy.couldNotRead} loading="Reading the budget." />
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
                    {account.pendingReserved ? <p className="type-caption text-muted-foreground">{copy.pendingReserved}: {account.pendingReserved}</p> : null}
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
        {view.pendingReservations.length > 0 ? (
          <div className="mt-3 rounded-lg border px-4 py-3">
            <p className="type-body-small">{copy.pendingReservationsDetail}</p>
            <ul className="mt-2 space-y-1">
              {view.pendingReservations.map((reservation) => (
                <li className="type-caption flex justify-between gap-4" key={reservation.id}>
                  <span>{reservation.purpose}{reservation.date ? ` · ${reservation.date}` : ""}</span>
                  <span className="type-numeric">{reservation.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section description={copy.forecastDetail} title={copy.forecast}>
        <FactGrid items={[view.expectedIncome, view.expectedPayments, view.gap].map((fact) => ({
          label: fact.label,
          value: shownAmount(fact.amount),
          detail: fact.caption,
        }))} />
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
