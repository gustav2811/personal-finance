"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { addMonths, cycleLabel } from "@/domain/budget/cycle"
import { chartRows, projectHistory, type HistoryProjection, type HistoryRow } from "@/domain/budget/history"
import { memberName, type MemberRef } from "@/domain/budget/members"
import type { BeneficiaryFilter } from "@/domain/budget/overview"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readMemberDirectory } from "./members"
import { readActuals, readVersion, readVersions } from "./rpc"

const PLAN_CHANGE = "A plan change is not a corrected transaction."
const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"
const PAGE_CAP = 20

type VersionHeader = {
  id: string
  label: string
}

type Loaded = {
  version: unknown
  parent: unknown
  actuals: unknown
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
  return { id, label }
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
  return { version, parent, actuals }
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
              <TableCell>{row.name}</TableCell>
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
  const [versions, setVersions] = useState<VersionHeader[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [members, setMembers] = useState<MemberRef[]>([])
  const [filter, setFilter] = useState<BeneficiaryFilter>({ kind: "household" })
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadVersionHeaders(), readMemberDirectory()])
      .then(([headers, people]) => {
        if (cancelled) return
        setVersions(headers)
        setMembers(people)
        setSelectedId(headers[0]?.id ?? null)
        if (headers.length === 0) setReading(false)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : copy.couldNotRead)
        setReading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setReading(true)
    setError(null)
    setLoaded(null)
    void loadComparison(selectedId)
      .then((next) => {
        if (cancelled) return
        setLoaded(next)
        setReading(false)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setLoaded(null)
        setError(caught instanceof Error ? caught.message : copy.couldNotRead)
        setReading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const view = loaded ? projectHistory({ ...loaded, filter }) : null
  const filterValue = filter.kind === "member" ? filter.memberId : filter.kind
  const namedMembers = members.map((member) => ({
    id: member.id,
    name: memberName(members, member.id) ?? "A household member",
  }))

  return (
    <div className="@container/budget space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: "History" }]}
        description={PLAN_CHANGE}
        title="History"
      />
      {error ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {versions.length > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select
            onValueChange={(next) => {
              if (next) setSelectedId(next)
            }}
            value={selectedId ?? undefined}
          >
            <SelectTrigger aria-label={copy.revision} className="w-72 pointer-coarse:h-9">
              <SelectValue placeholder={copy.revision} />
            </SelectTrigger>
            <SelectContent>
              {versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {version.label}
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
      {reading && !view ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {!reading && versions.length === 0 && !error ? (
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
      <p className="type-caption text-muted-foreground">
        {view.householdTotalLabel}: <span className="type-numeric">{view.householdTotal}</span>. {view.householdTotalDetail}
      </p>
      {view.partialList ? <p className="type-caption text-muted-foreground">{view.partialList}</p> : null}
      <ComparisonBars rows={bars} />
      <Section title={copy.purposes}>
        <HistoryTable rows={view.rows} />
      </Section>
    </>
  )
}
