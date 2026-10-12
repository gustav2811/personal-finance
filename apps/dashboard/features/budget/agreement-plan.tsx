"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { copy } from "@/domain/budget/copy"
import { formatDayMonth } from "@/domain/budget/cycle"
import { memberName, type MemberRef } from "@/domain/budget/members"
import { absoluteCents, centsToRandsInput, formatCents, isCents } from "@/domain/budget/money"
import { randsToCents } from "@/domain/budget/move"
import { planDiff, replaceLine, type PlanLine } from "@/domain/budget/plan"
import { groupTitle, placeGroup, type PurposeGroup } from "@/domain/budget/presentation"
import { PurposeTarget } from "@/domain/budget/purpose-target"
import type { SavedFact } from "@/domain/budget/checks"
import type { CutoverAccount, CutoverCategory, CutoverFund } from "@/domain/budget/cutover"
import { blankIncome, type IncomeForm } from "./agreement-form"

const CONTROL = "h-11"
const GROUPS: PurposeGroup[] = ["bills", "everyday", "saved"]

function signedChange(before: string, after: string): string | null {
  if (!isCents(before) || !isCents(after) || before === after) return null
  const delta = (BigInt(after) - BigInt(before)).toString()
  const absolute = absoluteCents(delta)
  if (!absolute) return null
  return delta.startsWith("-") ? `${formatCents(absolute)} less` : `${formatCents(absolute)} more`
}

function whom(line: PlanLine, members: readonly MemberRef[]): string {
  if (line.beneficiaryScope === "shared") return copy.shared
  return memberName(members, line.beneficiaryMemberId) ?? "Not assigned"
}

function payer(line: PlanLine, members: readonly MemberRef[]): string {
  return memberName(members, line.plannedPayerMemberId) ?? "Not assigned"
}

export function IncomeFields({
  editing,
  members,
  rows,
  onChange,
  onCommitScale,
}: {
  editing: boolean
  members: readonly MemberRef[]
  rows: readonly IncomeForm[]
  onChange: (rows: IncomeForm[]) => void
  onCommitScale?: () => void
}) {
  return (
    <div className="space-y-4" id="expected-income">
      <div className="space-y-1">
        <h2 className="type-section-title">Expected income</h2>
        <p className="type-body-small max-w-3xl text-muted-foreground">
          Net amounts and expected dates. Unknown stays unknown. {copy.receivingAccountUnknown}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="type-body">Household members could not be read, so income cannot be named yet.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row, index) => {
            const name = memberName(members, row.memberId) ?? "A household member"
            return (
              <li className="grid gap-3 border-b pb-4 sm:grid-cols-2" key={row.memberId}>
                <p className="type-body sm:col-span-2">{name}</p>
                <div className="grid gap-1.5">
                  <Label htmlFor={`income-amount-${row.memberId}`}>Net amount (R)</Label>
                  {editing ? (
                    <Input
                      className={`${CONTROL} type-numeric`}
                      id={`income-amount-${row.memberId}`}
                      inputMode="decimal"
                      onBlur={onCommitScale}
                      onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, centsText: event.target.value } : item))}
                      value={row.centsText}
                    />
                  ) : (
                    <p className="type-numeric">{row.centsText.trim().length === 0 ? "Unknown" : formatCents(randsToCents(row.centsText))}</p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`income-date-${row.memberId}`}>Expected date</Label>
                  {editing ? (
                    <Input
                      className={CONTROL}
                      id={`income-date-${row.memberId}`}
                      onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, expectedOn: event.target.value } : item))}
                      type="date"
                      value={row.expectedOn}
                    />
                  ) : (
                    <p>{row.expectedOn ? formatDayMonth(row.expectedOn) : "Unknown"}</p>
                  )}
                </div>
                <p className="type-caption text-muted-foreground sm:col-span-2">{copy.receivingAccountUnknown}</p>
              </li>
            )
          })}
        </ul>
      )}
      {editing && members.length > rows.length ? (
        <Button
          className={CONTROL}
          onClick={() => {
            const missing = members.find((member) => !rows.some((row) => row.memberId === member.id))
            if (missing) onChange([...rows, blankIncome(missing.id)])
          }}
          type="button"
          variant="outline"
        >
          Add income
        </Button>
      ) : null}
    </div>
  )
}

export function AgreementPlan({
  accounts,
  categories,
  editing,
  expandedId,
  funds,
  historical,
  lines,
  members,
  onAddFund,
  onCommitScale,
  onCreate,
  onExpand,
  onLines,
  onOverrides,
  overrides,
  publishedLines,
  saved,
}: {
  accounts: readonly CutoverAccount[]
  categories: readonly CutoverCategory[]
  editing: boolean
  expandedId: string | null
  funds: readonly CutoverFund[]
  historical: boolean
  lines: readonly PlanLine[]
  members: readonly MemberRef[]
  onAddFund: (fund: CutoverFund) => void
  onCommitScale: () => void
  onCreate: (name: string, group: PurposeGroup) => void
  onExpand: (stableLineId: string | null) => void
  onLines: (lines: PlanLine[]) => void
  onOverrides: (overrides: Map<string, PurposeGroup>) => void
  overrides: ReadonlyMap<string, PurposeGroup>
  publishedLines: readonly PlanLine[]
  saved: ReadonlyMap<string, SavedFact> | null
}) {
  const [name, setName] = useState("")
  const [group, setGroup] = useState<PurposeGroup>("everyday")
  const changed = new Set(planDiff(publishedLines, lines).filter((row) => !row.unchanged).map((row) => row.stableLineId))
  const suggestions = funds.filter((fund) => fund.status === "active" && !lines.some((line) => line.fundId === fund.id))
  const placed = lines.map((line) => ({ line, placement: placeGroup(line, overrides.get(line.stableLineId)) }))
  const sections: Array<PurposeGroup | "ungrouped"> = ["bills", "everyday", "saved", "ungrouped"]

  function patch(stableLineId: string, next: Partial<PlanLine>) {
    onLines(replaceLine(lines, stableLineId, next))
  }

  return (
    <div className="space-y-6" id="our-plan">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="type-section-title">{copy.ourPlan}</h2>
        {editing ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim().length === 0) return
              onCreate(name.trim(), group)
              setName("")
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="new-purpose">Purpose</Label>
              <Input className={CONTROL} id="new-purpose" onChange={(event) => setName(event.target.value)} value={name} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-purpose-group">Group</Label>
              <Select onValueChange={(next) => { if (next === "bills" || next === "everyday" || next === "saved") setGroup(next) }} value={group}>
                <SelectTrigger className={`w-44 ${CONTROL}`} id="new-purpose-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUPS.map((item) => <SelectItem key={item} value={item}>{groupTitle(item)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className={CONTROL} type="submit" variant="outline">{copy.addPurpose}</Button>
          </form>
        ) : null}
      </div>
      <p className="type-caption max-w-3xl text-muted-foreground">{copy.groupNotStored} {copy.noSpreadsheet}</p>
      {editing && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((fund) => (
            <Button className={CONTROL} key={fund.id} onClick={() => onAddFund(fund)} type="button" variant="outline">
              Add {fund.name}
            </Button>
          ))}
        </div>
      ) : null}
      {lines.length === 0 ? <p className="type-body text-muted-foreground">No purposes yet.</p> : null}
      {sections.map((section) => {
        const rows = placed.filter((row) => row.placement.group === section)
        if (rows.length === 0) return null
        return (
          <section className="space-y-1" key={section}>
            <h3 className="type-label pt-4">{groupTitle(section)}</h3>
            <div className="divide-y">
              {rows.map(({ line, placement }) => {
                const open = expandedId === line.stableLineId
                const isChanged = changed.has(line.stableLineId)
                const published = publishedLines.find((row) => row.stableLineId === line.stableLineId)
                const delta = published ? signedChange(published.contributionCents, line.contributionCents) : null
                const fact = saved?.get(line.fundId) ?? null
                return (
                  <div
                    className={isChanged && editing ? "border-l-2 border-l-chart-2 py-3 pl-3" : "py-3"}
                    key={line.stableLineId}
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_9rem_7rem_7rem] sm:items-end">
                      <div className="min-w-0">
                        <p className="type-body">{line.name}</p>
                        {isChanged && editing ? <p className="type-caption">{copy.changed}</p> : null}
                        {delta ? <p className="type-caption text-muted-foreground">{delta}</p> : null}
                        <p className="type-caption text-muted-foreground">
                          {line.fundingBehaviour === "accumulating" ? "Accumulates · No fixed deadline" : null}
                          {line.dueOn && line.targetCents ? `Target ${formatCents(line.targetCents)} · Due ${formatDayMonth(line.dueOn)}` : null}
                          {fact?.savedCents ? ` · Saved ${formatCents(fact.savedCents)}` : ""}
                        </p>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`contribution-${line.stableLineId}`}>Contribution (R)</Label>
                        {editing ? (
                          <Input
                            aria-invalid={!isCents(line.contributionCents) || line.contributionCents.startsWith("-")}
                            className={`${CONTROL} type-numeric`}
                            id={`contribution-${line.stableLineId}`}
                            inputMode="decimal"
                            onBlur={onCommitScale}
                            onChange={(event) => {
                              const cents = randsToCents(event.target.value)
                              patch(line.stableLineId, { contributionCents: cents ?? event.target.value })
                            }}
                            value={isCents(line.contributionCents) ? centsToRandsInput(line.contributionCents) : line.contributionCents}
                          />
                        ) : (
                          <p className="type-numeric">{formatCents(isCents(line.contributionCents) ? line.contributionCents : null)}</p>
                        )}
                      </div>
                      <div>
                        <p className="type-caption text-muted-foreground">{copy.forWhom}</p>
                        <p>{whom(line, members)}</p>
                      </div>
                      <div>
                        <p className="type-caption text-muted-foreground">{copy.plannedPayer}</p>
                        <p>{payer(line, members)}</p>
                      </div>
                    </div>
                    <Button
                      aria-expanded={open}
                      className={`${CONTROL} mt-2`}
                      onClick={() => onExpand(open ? null : line.stableLineId)}
                      type="button"
                      variant="outline"
                    >
                      {open ? "Hide details" : "Details"}
                    </Button>
                    {open ? (
                      <PurposeDetails
                        accounts={accounts}
                        categories={categories}
                        editing={editing}
                        fact={fact}
                        historical={historical}
                        line={line}
                        members={members}
                        groupOverride={overrides.get(line.stableLineId)}
                        onGroup={(next) => {
                          const nextOverrides = new Map(overrides)
                          nextOverrides.set(line.stableLineId, next)
                          onOverrides(nextOverrides)
                        }}
                        onPatch={(next) => patch(line.stableLineId, next)}
                        placementAmbiguous={placement.ambiguous}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PurposeDetails({
  accounts,
  categories,
  editing,
  fact,
  historical,
  groupOverride,
  line,
  members,
  onGroup,
  onPatch,
  placementAmbiguous,
}: {
  accounts: readonly CutoverAccount[]
  categories: readonly CutoverCategory[]
  editing: boolean
  fact: SavedFact | null
  groupOverride: PurposeGroup | undefined
  historical: boolean
  line: PlanLine
  members: readonly MemberRef[]
  onGroup: (group: PurposeGroup) => void
  onPatch: (next: Partial<PlanLine>) => void
  placementAmbiguous: boolean
}) {
  const dated = line.fundingBehaviour === "target_by_date" || Boolean(line.dueOn && line.targetCents)
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <p className="type-caption text-muted-foreground sm:col-span-2">
        A category describes a purchase. This purpose is what the household reserves money for. {copy.contributionNotMove}
      </p>
      {editing ? (
        <>
          <Field label="For whom">
            <Select
              onValueChange={(next) => {
                if (next === "shared") onPatch({ beneficiaryScope: "shared", beneficiaryMemberId: null })
                else onPatch({ beneficiaryScope: "member", beneficiaryMemberId: next })
              }}
              value={line.beneficiaryScope === "member" && line.beneficiaryMemberId ? line.beneficiaryMemberId : "shared"}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">{copy.shared}</SelectItem>
                {members.map((member) => <SelectItem key={member.id} value={member.id}>{memberName(members, member.id)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Paid by">
            <Select
              onValueChange={(next) => onPatch({ plannedPayerMemberId: next === "unassigned" ? null : next })}
              value={line.plannedPayerMemberId ?? "unassigned"}
            >
              <SelectTrigger className={CONTROL} id={`purpose-${line.stableLineId}-payer`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Not assigned</SelectItem>
                {members.map((member) => <SelectItem key={member.id} value={member.id}>{memberName(members, member.id)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="type-caption text-muted-foreground">Either is not stored. Leave this unassigned if either person may pay. Paying does not make a shared bill personal.</p>
          </Field>
          <Field label="Category">
            <Select
              onValueChange={(next) => {
                if (next === "none") onPatch({ categoryId: null, categoryNameSnapshot: null, matchCategoryId: null, groupNameSnapshot: null })
                else {
                  const category = categories.find((entry) => entry.id === next)
                  onPatch({
                    categoryId: next,
                    matchCategoryId: next,
                    categoryNameSnapshot: category?.name ?? null,
                    groupNameSnapshot: category?.groupName ?? null,
                  })
                }
              }}
              value={line.categoryId ?? "none"}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Paying account">
            <Select
              onValueChange={(next) => onPatch({ expectedPaymentAccountId: next === "none" ? null : next })}
              value={line.expectedPaymentAccountId ?? "none"}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expected payment date">
            <Input className={CONTROL} onChange={(event) => onPatch({ expectedPaymentOn: event.target.value || null })} type="date" value={line.expectedPaymentOn ?? ""} />
          </Field>
          <Field label="Due date">
            <Input className={CONTROL} onChange={(event) => onPatch({ dueOn: event.target.value || null })} type="date" value={line.dueOn ?? ""} />
          </Field>
          <Field label="Target (R)">
            <Input
              className={`${CONTROL} type-numeric`}
              id={`purpose-${line.stableLineId}-target`}
              inputMode="decimal"
              onChange={(event) => onPatch({ targetCents: randsToCents(event.target.value) ?? (event.target.value ? event.target.value : null) })}
              value={line.targetCents && isCents(line.targetCents) ? centsToRandsInput(line.targetCents) : line.targetCents ?? ""}
            />
          </Field>
          <Field label="Funding">
            <Select
              onValueChange={(next) => {
                if (next === "cycle_allowance" || next === "accumulating" || next === "target_by_date" || next === "reserve_target") {
                  onPatch({ fundingBehaviour: next })
                }
              }}
              value={line.fundingBehaviour}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cycle_allowance">This cycle</SelectItem>
                <SelectItem value="accumulating">Accumulates</SelectItem>
                <SelectItem value="target_by_date">Target by date</SelectItem>
                <SelectItem value="reserve_target">Reserve</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Recurrence">
            <Select
              onValueChange={(next) => { if (next === "cycle" || next === "annual" || next === "once") onPatch({ recurrence: next }) }}
              value={line.recurrence}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cycle">Each cycle</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="once">Once</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Rollover">
            <Select
              onValueChange={(next) => { if (next === "carry" || next === "release_explicit") onPatch({ rolloverPolicy: next }) }}
              value={line.rolloverPolicy}
            >
              <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="carry">Unused money stays</SelectItem>
                <SelectItem value="release_explicit">Release only when asked</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {placementAmbiguous ? (
            <Field label="Group for this visit">
              <Select onValueChange={(next) => { if (next === "bills" || next === "everyday" || next === "saved") onGroup(next) }} value={groupOverride ?? "unset"}>
                <SelectTrigger className={CONTROL}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not grouped</SelectItem>
                  {GROUPS.map((item) => <SelectItem key={item} value={item}>{groupTitle(item)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="type-caption text-muted-foreground">{copy.groupNotStored}</p>
            </Field>
          ) : null}
        </>
      ) : (
        <p className="type-body-small sm:col-span-2">
          {whom(line, members)} · Paid by {payer(line, members)}
          {line.categoryNameSnapshot ? ` · Category ${line.categoryNameSnapshot}` : ""}
          {line.expectedPaymentOn ? ` · Payment ${formatDayMonth(line.expectedPaymentOn)}` : ""}
        </p>
      )}
      <div className="sm:col-span-2">
        {line.fundingBehaviour === "accumulating" && !line.dueOn ? (
          <p className="type-body-small">
            Contribution {formatCents(isCents(line.contributionCents) ? line.contributionCents : null)}. Saved {fact?.savedCents ? formatCents(fact.savedCents) : "not in this read"}. These are different facts.
          </p>
        ) : null}
        {dated ? (
          <PurposeTarget
            accessibleOn={fact?.accessibleOn ?? null}
            dueOn={line.dueOn}
            historical={historical}
            restrictedCents={fact?.restrictedCents ?? null}
            savedCents={fact?.savedCents ?? null}
            targetCents={line.targetCents}
          />
        ) : null}
      </div>
    </div>
  )
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
