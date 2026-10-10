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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy } from "@/domain/budget/copy"
import { projectBudget, type BeneficiaryFilter, type BudgetOverview, type PurposeRow } from "@/domain/budget/overview"
import { getBudgetSource, type BudgetSource } from "./queries"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"

function Fact({ fact }: { fact: BudgetOverview["unassigned"] }) {
  return (
    <div className="space-y-1 bg-card px-4 py-3">
      <p className="type-label text-muted-foreground">{fact.label}</p>
      <p className="type-numeric text-2xl font-semibold tracking-tight">
        {fact.withheld ? copy.needsReconciliation : (fact.amount ?? copy.withheld)}
      </p>
      <p className="type-caption text-muted-foreground">{fact.caption}</p>
    </div>
  )
}

function PurposeTable({ rows }: { rows: PurposeRow[] }) {
  if (rows.length === 0) {
    return <p className="type-body text-muted-foreground">Nothing in this view.</p>
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purpose</TableHead>
            <TableHead className="text-right">{copy.plan}</TableHead>
            <TableHead className="text-right">{copy.assigned}</TableHead>
            <TableHead className="text-right">{copy.spent}</TableHead>
            <TableHead className="text-right">{copy.available}</TableHead>
            <TableHead>{copy.nextNeed}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.fundId}>
              <TableCell>
                <div className="space-y-1">
                  <p>{row.name}</p>
                  <details>
                    <summary className="type-caption cursor-pointer text-muted-foreground">Details</summary>
                    <ul className="type-caption mt-1 space-y-1 text-muted-foreground">
                      {row.disclosure.map((sentence) => (
                        <li key={sentence}>{sentence}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              </TableCell>
              <TableCell className="type-numeric text-right">{row.plan}</TableCell>
              <TableCell className="type-numeric text-right">{row.assigned}</TableCell>
              <TableCell className="type-numeric text-right">{row.spent}</TableCell>
              <TableCell className={`type-numeric text-right ${row.deficit ? "text-warning" : ""}`}>
                {row.available}
              </TableCell>
              <TableCell className="type-caption">{row.nextNeed}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function BudgetView() {
  const [source, setSource] = useState<BudgetSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<BeneficiaryFilter>({ kind: "household" })

  useEffect(() => {
    let cancelled = false
    void getBudgetSource()
      .then((next) => {
        if (!cancelled) setSource(next)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : copy.couldNotRead)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const view = source ? projectBudget({ ...source, filter }) : null
  const filterValue = filter.kind === "member" ? filter.memberId : filter.kind

  return (
    <div className="@container/budget space-y-10">
      <PageHeader description={copy.pageDescription} title={copy.pageTitle} />
      {error ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!view && !error ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {view ? <BudgetBody filterValue={filterValue} onFilter={setFilter} view={view} /> : null}
    </div>
  )
}

function BudgetBody({
  filterValue,
  onFilter,
  view,
}: {
  filterValue: string
  onFilter: (filter: BeneficiaryFilter) => void
  view: BudgetOverview
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{view.cycleLabel}</p>
          <p className="type-caption text-muted-foreground">
            {view.revisionLabel} · {view.asOfLabel}
          </p>
        </div>
        <ToggleGroup
          aria-label={copy.whoseExpense}
          onValueChange={(next) => {
            if (next === "household" || next === "shared") onFilter({ kind: next })
            else if (next) onFilter({ kind: "member", memberId: next })
          }}
          size="sm"
          spacing={0}
          type="single"
          value={filterValue}
          variant="outline"
        >
          <ToggleGroupItem className={TOUCH} value="household">
            {copy.household}
          </ToggleGroupItem>
          <ToggleGroupItem className={TOUCH} value="shared">
            {copy.shared}
          </ToggleGroupItem>
          {view.members.map((member) => (
            <ToggleGroupItem className={TOUCH} key={member.id} value={member.id}>
              {member.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {view.complete ? null : (
        <Alert>
          <AlertTitle>{copy.needsReconciliation}</AlertTitle>
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

      <section aria-label={copy.availableByPurpose} className="space-y-4">
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{copy.availableByPurpose}</p>
          <p className="type-caption text-muted-foreground">{copy.availableByPurposeDetail}</p>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-lg border bg-border @3xl/budget:grid-cols-3">
          <div className="space-y-1 bg-card px-4 py-3">
            <p className="type-label text-muted-foreground">{copy.availableByPurpose}</p>
            <p className="type-body">{view.complete ? copy.seeEachPurpose : copy.needsReconciliation}</p>
            <p className="type-caption text-muted-foreground">{copy.availableByPurposeDetail}</p>
          </div>
          <Fact fact={view.unassigned} />
          <div className="space-y-1 bg-card px-4 py-3">
            <p className="type-label text-muted-foreground">{copy.liquidity}</p>
            {view.accounts.length === 0 ? (
              <p className="type-body text-muted-foreground">
                {view.liquidity.withheld ? copy.needsReconciliation : copy.noReconciledAccounts}
              </p>
            ) : (
              <ul className="space-y-1">
                {view.accounts.map((account) => (
                  <li className="type-numeric flex justify-between gap-4" key={account.id}>
                    <span>{account.label}</span>
                    <span>{account.amount}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.cardDebt ? (
              <p className="type-caption text-muted-foreground">
                {copy.cardDebt}: {view.cardDebt}. {copy.cardDebtDetail}
              </p>
            ) : null}
          </div>
        </dl>
        <p className="type-caption text-muted-foreground">
          {view.forecast.label}: {view.forecast.amount ?? copy.withheld}. {view.forecast.caption}
        </p>
      </section>

      <Section description={copy.availableByPurposeDetail} title={copy.purposes}>
        <PurposeTable rows={view.purposes} />
      </Section>
      <Section description={copy.commitmentsDetail} title={copy.commitments}>
        <PurposeTable rows={view.commitments} />
      </Section>
      {view.retired.length > 0 ? (
        <Section title={copy.retired}>
          <PurposeTable rows={view.retired} />
        </Section>
      ) : null}
      <Section description={copy.purchasesDetail} title={copy.purchases}>
        {view.listPartial ? <p className="type-caption text-muted-foreground">{copy.partialList}</p> : null}
        {view.householdConsumption ? (
          <p className="type-caption text-muted-foreground">
            {copy.householdTotal}: {view.householdConsumption}. {copy.householdTotalDetail}
          </p>
        ) : null}
        {view.purchases.length === 0 ? (
          <p className="type-body text-muted-foreground">No recognised purchases in this view.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {view.purchases.map((purchase) => (
              <li className="flex items-baseline justify-between gap-4 px-4 py-3" key={purchase.id}>
                <span>
                  <span className="block">{purchase.attribution}</span>
                  <span className="type-caption text-muted-foreground">{purchase.purpose}</span>
                </span>
                <span className="type-numeric">{purchase.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
