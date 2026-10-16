"use client"

import { useCallback, useState } from "react"
import { useResource } from "@/hooks/use-resource"
import { ResourceFeedback } from "./read-feedback"
import Link from "next/link"
import { PageHeader } from "@/components/patterns/page-header"
import { Button } from "@/components/ui/button"
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
import { addMonths, currentCycle } from "@/domain/budget/cycle"
import { projectBudget, type BeneficiaryFilter, type BudgetOverview, type PurposeRow } from "@/domain/budget/overview"
import { agreementHref, projectRoutine, routineHref, type HouseholdRoutine } from "@/domain/budget/routine"
import { MoveMoneyDialog } from "./move-dialog"
import { getBudgetSource } from "./queries"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"

function Answer({ answer }: { answer: HouseholdRoutine["spend"] }) {
  return (
    <div className="max-w-3xl space-y-1">
      <p className="type-body">
        {answer.amount ? <span className="type-numeric">{answer.amount} </span> : null}
        {answer.sentence}
      </p>
      {answer.detail ? <p className="type-body-small text-muted-foreground">{answer.detail}</p> : null}
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
            <TableHead className="text-right">{copy.pendingReserved}</TableHead>
            <TableHead className="text-right">{copy.available}</TableHead>
            <TableHead>{copy.nextNeed}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.fundId}>
              <TableCell>
                <div className="space-y-1">
                  <p>
                    <Link className="underline-offset-4 hover:underline" href={`/budget/funds/${row.fundId}`}>
                      {row.name}
                    </Link>
                  </p>
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
              <TableCell className="type-numeric text-right">{row.pendingReserved ?? "—"}</TableCell>
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

export function BudgetView({ loadSource = getBudgetSource }: { loadSource?: typeof getBudgetSource } = {}) {
  const [filter, setFilter] = useState<BeneficiaryFilter>({ kind: "household" })
  const [cycleStart, setCycleStart] = useState(() => currentCycle().start)
  const [saved, setSaved] = useState(false)
  const load = useCallback(() => loadSource(cycleStart), [cycleStart, loadSource])
  const resource = useResource({ key: `budget:overview:${cycleStart}`, load, retainData: true })
  const source = resource.hasData ? resource.data! : null

  const view = source ? projectBudget({ ...source, filter }) : null
  const routine = source ? projectRoutine(source) : null
  const step = routine ? routineHref(routine.next) : null

  return (
    <div className="@container/budget space-y-10">
      <PageHeader
        actions={
          step ? (
            <Button asChild>
              <Link href={step.href}>{step.label}</Link>
            </Button>
          ) : null
        }
        description={view?.cycleLabel ?? copy.pageDescription}
        title={copy.pageTitle}
      />
      <ResourceFeedback resource={resource} title={copy.couldNotRead} loading="Reading the budget." saved={saved} />
      {view && routine ? (
        <BudgetBody
          cycleStart={cycleStart}
          filterValue={filter.kind === "member" ? filter.memberId : filter.kind}
          onCycle={(next) => { setSaved(false); setCycleStart(next) }}
          onFilter={setFilter}
          onSaved={() => { setSaved(true); void resource.reload() }}
          fresh={resource.status === "ready"}
          routine={routine}
          view={view}
        />
      ) : null}
    </div>
  )
}

function BudgetBody({
  cycleStart,
  fresh,
  filterValue,
  onCycle,
  onFilter,
  onSaved,
  routine,
  view,
}: {
  cycleStart: string
  fresh: boolean
  filterValue: string
  onCycle: (cycleStart: string) => void
  onFilter: (filter: BeneficiaryFilter) => void
  onSaved: () => void
  routine: HouseholdRoutine
  view: BudgetOverview
}) {
  const viewingNow = cycleStart === currentCycle().start
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button className={TOUCH} onClick={() => onCycle(addMonths(cycleStart, -1))} size="sm" type="button" variant="outline">
          Earlier
        </Button>
        <Button className={TOUCH} onClick={() => onCycle(currentCycle().start)} size="sm" type="button" variant="outline">
          {copy.thisCycle}
        </Button>
        <Button className={TOUCH} onClick={() => onCycle(addMonths(cycleStart, 1))} size="sm" type="button" variant="outline">
          Later
        </Button>
      </div>

      {routine.stale ? (
        <Alert>
          <AlertDescription>{routine.stale}</AlertDescription>
        </Alert>
      ) : null}

      <Section title={copy.spendQuestion}>
        <Answer answer={routine.spend} />
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

      <Section title={copy.cashQuestion}>
        <Answer answer={routine.cash} />
        {viewingNow ? null : (
          <p className="type-caption text-muted-foreground">This cash position is now, not the cycle above.</p>
        )}
        {view.calendar.length > 0 ? (
          <details>
            <summary className="type-caption cursor-pointer text-muted-foreground">{copy.expectedPayments}</summary>
            <ul className="mt-2 space-y-1">
              {view.calendar.map((entry) => (
                <li className="type-caption flex justify-between gap-4" key={`${entry.date ?? ""}-${entry.label}-${entry.amount}`}>
                  <span>
                    {entry.date ?? copy.withheld}
                    {entry.payer ? ` · ${entry.payer}` : ""}
                  </span>
                  <span className="type-numeric">{entry.amount}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="type-caption text-muted-foreground">
          <Link className="underline-offset-4 hover:underline" href="/budget/liquidity">
            {copy.cashInEachAccount}
          </Link>
        </p>
      </Section>

      <Section title={copy.attentionQuestion}>
        <p className="type-body max-w-3xl">{routine.attention.sentence}</p>
        {routine.attention.items.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {routine.attention.items.map((item) => (
              <li className="flex items-baseline justify-between gap-4 px-4 py-3" key={item.id}>
                <span>
                  <span className="block">{item.sentence}</span>
                  {item.when ? <span className="type-caption text-muted-foreground">{item.when}</span> : null}
                </span>
                <span className="type-numeric">{item.amount}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {routine.attention.more ? <p className="type-caption text-muted-foreground">{copy.moreDecisions}</p> : null}
      </Section>

      <Section title={copy.agreementQuestion}>
        <Answer answer={routine.agreement} />
        <p className="type-caption text-muted-foreground">
          <Link className="underline-offset-4 hover:underline" href={agreementHref(routine).href}>
            {agreementHref(routine).label}
          </Link>
        </p>
      </Section>

      <p className="type-caption text-muted-foreground">
        {view.forecast.label}: {view.forecast.amount ?? copy.withheld}. {view.forecast.caption}
      </p>

      <Section
        actions={
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
        }
        description={copy.availableByPurposeDetail}
        title={copy.purposes}
      >
        <MoveMoneyDialog
          canAssign={fresh && view.canAssign}
          funds={[...view.purposes, ...view.commitments, ...view.retired].map((row) => ({
            id: row.fundId,
            name: row.name,
            balanceLabel: row.available,
          }))}
          onSaved={onSaved}
          reconciliationFingerprint={view.reconciliationFingerprint}
          reconciliationId={view.reconciliationId}
          versionId={view.versionId}
        />
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

      <p className="type-caption text-muted-foreground">
        <Link className="underline-offset-4 hover:underline" href="/budget/history">
          History
        </Link>
        {" · "}
        <Link className="underline-offset-4 hover:underline" href="/budget/reconcile">
          {copy.reconcile}
        </Link>
      </p>
    </>
  )
}
