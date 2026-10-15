"use client"

import { useCallback, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { ResourceFeedback } from "./read-feedback"
import { Section } from "@/components/patterns/section"
import { useResource } from "@/hooks/use-resource"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ComparisonBars } from "@/domain/budget/comparison-bars"
import { copy } from "@/domain/budget/copy"
import { addMonths, calendarMonthLabel, calendarMonthRange, cycleLabel } from "@/domain/budget/cycle"
import { chartRows, projectHistory, type HistoryProjection, type HistoryRow } from "@/domain/budget/history"
import { memberName, type MemberRef } from "@/domain/budget/members"
import type { BeneficiaryFilter } from "@/domain/budget/overview"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readMemberDirectory } from "./members"
import { readActuals, readVersion, readVersions } from "./rpc"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"
const PAGE_CAP = 20

type VersionHeader = {
  id: string
  label: string
  month: string
}

type Loaded = {
  version: unknown
  parent: unknown
  actuals: unknown
  calendarActuals: unknown
}

function versionNumber(record: Record<string, unknown>): string | null {
  const value = record.version_number
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function headerOf(value: unknown): VersionHeader | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, "version_id")
  const starts = readString(record, "starts_on_cycle")
  if (!id || !starts) return null
  let cycle = starts
  try {
    cycle = cycleLabel(starts, addMonths(starts, 1))
  } catch {
    return null
  }
  const number = versionNumber(record)
  const revision = number ? `${copy.revision} ${number}` : copy.revision
  const state = readString(record, "state")
  const label = state === "draft" ? `${revision} · ${cycle} · draft` : `${revision} · ${cycle}`
  let month = cycle
  try {
    month = calendarMonthLabel(starts)
  } catch {
    month = cycle
  }
  return { id, label, month }
}

function headersFrom(payload: unknown): VersionHeader[] {
  const record = readRecord(payload)
  return readArray(record?.versions).flatMap((entry) => {
    const header = headerOf(entry)
    return header ? [header] : []
  })
}

async function loadVersionHeaders(): Promise<VersionHeader[]> {
  const byId = new Map<string, VersionHeader>()
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const payload = await readVersions(cursor)
    for (const header of headersFrom(payload)) byId.set(header.id, header)
    const record = readRecord(payload)
    const next = record ? readString(record, "next_cursor") : null
    if (!next || seen.has(next)) break
    seen.add(next)
    cursor = next
  }
  return [...byId.values()]
}

function versionBody(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value)
  if (!record) return null
  return readRecord(record.version) ?? record
}

async function loadComparison(versionId: string): Promise<Loaded> {
  const version = await readVersion(versionId)
  const body = versionBody(version)
  const starts = body ? readString(body, "starts_on_cycle") : null
  if (!starts) throw new Error(copy.couldNotRead)
  const parentId = body ? readString(body, "parent_version_id") : null
  const parent = parentId ? await readVersion(parentId) : null
  const actuals = await readActuals({ from: starts, to: addMonths(starts, 1) })
  const calendarActuals = await readCalendarActuals(calendarMonthRange(starts))
  return { version, parent, actuals, calendarActuals }
}

async function readCalendarActuals(range: { from: string; to: string }): Promise<unknown> {
  const entries: unknown[] = []
  let cursor: string | null = null
  let last: Record<string, unknown> | null = null
  const seen = new Set<string>()
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const payload = await readActuals(range, cursor)
    const record = readRecord(payload)
    if (!record) throw new Error(copy.couldNotRead)
    last = record
    entries.push(...readArray(record.entries))
    const next = readString(record, "next_cursor")
    if (!next) return { ...record, entries, next_cursor: null }
    if (seen.has(next)) throw new Error(copy.couldNotRead)
    seen.add(next)
    cursor = next
  }
  return { ...(last ?? {}), entries, next_cursor: cursor }
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="type-body text-muted-foreground">Nothing in this view.</p>
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purpose</TableHead>
            <TableHead className="text-right">{copy.originalPlan}</TableHead>
            <TableHead className="text-right">{copy.revisedPlan}</TableHead>
            <TableHead className="text-right">{copy.spent}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.fundId}>
              <TableCell>
                <div className="space-y-1">
                  <p>{row.name}</p>
                  {row.planChange ? <p className="type-caption text-muted-foreground">{row.planChange}</p> : null}
                  {row.correction ? <p className="type-caption text-muted-foreground">{row.correction}</p> : null}
                </div>
              </TableCell>
              <TableCell className="type-numeric text-right">{row.original.text}</TableCell>
              <TableCell className="type-numeric text-right">{row.revised.text}</TableCell>
              <TableCell className="type-numeric text-right">{row.spent.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function HistoryView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<BeneficiaryFilter>({ kind: "household" })

  const loadList = useCallback(async (_signal: AbortSignal) => {
    const [versions, members] = await Promise.all([loadVersionHeaders(), readMemberDirectory()])
    return { versions, members }
  }, [])
  const listResource = useResource({ key: "budget:history-list", load: loadList })
  const listData = listResource.data
  const versions = listData?.versions ?? []
  const members = listData?.members ?? []
  const selectedVersion = selectedId && versions.some((version) => version.id === selectedId) ? selectedId : versions[0]?.id ?? null
  const loadComparisonResource = useCallback(async (_signal: AbortSignal) => {
    if (!selectedVersion) throw new Error(copy.couldNotRead)
    return await loadComparison(selectedVersion)
  }, [selectedVersion])
  const comparisonResource = useResource({
    key: `budget:history-comparison:${selectedVersion ?? "none"}`,
    load: loadComparisonResource,
    enabled: selectedVersion !== null,
  })
  const comparisonData = comparisonResource.data
  const view = comparisonData ? projectHistory({ ...comparisonData, filter }) : null
  const filterValue = filter.kind === "member" ? filter.memberId : filter.kind
  const namedMembers = members.map((member) => ({
    id: member.id,
    name: memberName(members, member.id) ?? "A household member",
  }))

  return (
    <div className="@container/budget space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: "History" }]}
        description={copy.planChangeIsNotCorrection}
        title="History"
      />
      <ResourceFeedback resource={listResource} title="Budget history could not be loaded" loading="Reading budget history…" />
      {listResource.hasData ? <ResourceFeedback resource={comparisonResource} title="This revision could not be loaded" loading="Reading the selected revision…" /> : null}
      {versions.length > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select
            onValueChange={(next) => {
              if (next) setSelectedId(next)
            }}
            value={selectedVersion ?? undefined}
          >
            <SelectTrigger aria-label={copy.revision} className="w-72 pointer-coarse:h-9">
              <SelectValue placeholder={copy.revision} />
            </SelectTrigger>
            <SelectContent>
              {versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {version.month} · {version.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            aria-label={copy.whoseExpense}
            onValueChange={(next) => {
              if (next === "household" || next === "shared") setFilter({ kind: next })
              else if (next) setFilter({ kind: "member", memberId: next })
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
            {namedMembers.map((member) => (
              <ToggleGroupItem className={TOUCH} key={member.id} value={member.id}>
                {member.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      {!listResource.hasData && listResource.status !== "error" ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {listResource.status === "ready" && versions.length === 0 ? (
        <p className="type-body text-muted-foreground">{copy.noPublishedPlan}</p>
      ) : null}
      {view ? <HistoryBody view={view} /> : null}
    </div>
  )
}

function HistoryBody({ view }: { view: HistoryProjection }) {
  const bars = chartRows(view.rows)
  return (
    <>
      <p className="type-caption text-muted-foreground">{view.planChangeNote}</p>
      <p className="type-caption text-muted-foreground">
        {view.householdTotalLabel}: <span className="type-numeric">{view.householdTotal}</span>. {view.householdTotalDetail}
      </p>
      {view.months.length > 0 ? (
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">Calendar month</p>
          <ul className="space-y-1">
            {view.months.map((month) => (
              <li className="flex justify-between gap-4" key={month.month}>
                <span>{month.label}</span>
                <span className="type-numeric">{month.consumption}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.chain.length > 0 ? (
        <ul className="space-y-1">
          {view.chain.map((hop) => (
            <li key={`${hop.id}-${hop.supersedesId}`}>{hop.sentence}</li>
          ))}
        </ul>
      ) : null}
      {view.corrections.length > 0 ? (
        <div className="space-y-1">
          <p>{view.correctionNote}</p>
          <ul className="space-y-1">
            {view.corrections.map((trail) => (
              <li key={trail.supersedesId}>
                {trail.sourceTransactionId ? (
                  <a className="underline-offset-4 hover:underline" href={`/transactions?transaction=${trail.sourceTransactionId}`}>
                    {trail.sourceTransactionId}
                  </a>
                ) : (
                  copy.withheld
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.partialList ? <p className="type-caption text-muted-foreground">{view.partialList}</p> : null}
      <ComparisonBars rows={bars} />
      <Section title={copy.purposes}>
        <HistoryTable rows={view.rows} />
      </Section>
    </>
  )
}
