"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Info, TriangleAlert } from "lucide-react"
import { PageHeader } from "@/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { commandFailureIsUncertain, commandFailureText, holdCommand, type HeldCommand } from "@/domain/budget/command-attempt"
import { buildCreateFundPayload, buildDraftPayload, buildPublishPayload, newCommandId } from "@/domain/budget/commands"
import { copy, publishedSentence } from "@/domain/budget/copy"
import { readCutover, type CutoverFund, type CutoverWorkspace } from "@/domain/budget/cutover"
import { addMonths, currentCycle, cycleLabel } from "@/domain/budget/cycle"
import { issuesFound, leadChecks, projectChecks, savedFactsFromOverview, type BudgetCheck, type CheckSeverity } from "@/domain/budget/checks"
import { contributionsInput, projectCapacity } from "@/domain/budget/capacity"
import { memberName, type MemberRef } from "@/domain/budget/members"
import { localDateKey } from "@/lib/format/date"
import { formatCents } from "@/domain/budget/money"
import { planDiff, readDraftReceipt, readPublishReceipt, readStoredPlan, readVersionPage, selectDraft, applicablePublished, latestPublished, cloneLines, blankLine, contributionsReady, toDraftLines, type PlanLine, type StoredPlan, type VersionHeader } from "@/domain/budget/plan"
import { PlanCapacityChart } from "@/domain/budget/plan-capacity"
import type { PurposeGroup } from "@/domain/budget/presentation"
import { projectBudget } from "@/domain/budget/overview"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { AgreementPlan, IncomeFields } from "./agreement-plan"
import { blankIncome, incomeFromPlan, incomeMoney, incomePayload, startingFunding, type IncomeForm } from "./agreement-form"
import { MoveMoneyDialog } from "./move-dialog"
import { readCutover as loadCutover, readLiquidity, readOverview, readReviewQueue, readVersion, readVersions, writeBudgetRpc } from "./rpc"

const CONTROL = "h-11"

type Hold = {
  fingerprint: string
  save: HeldCommand
  receipt: { versionId: string; draftRevision: string } | null
  publishId: string
  uncertain: boolean
  phase: "save" | "publish"
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function reviewHasItems(payload: unknown): boolean | null {
  const record = readRecord(payload)
  if (!record) return null
  if (readArray(record.entries).length > 0 || readArray(record.items).length > 0) return true
  const reasons = readArray(record.reasons)
  return reasons.some((entry) => readRecord(entry)?.code === "review_items_present")
}

async function loadHeaders(): Promise<VersionHeader[]> {
  const headers: VersionHeader[] = []
  let cursor: string | null = null
  do {
    const page = readVersionPage(await readVersions(cursor))
    headers.push(...page.versions)
    if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error(copy.couldNotRead)
    cursor = page.nextCursor
  } while (cursor)
  return headers
}

function cycleOptions(today: string, headers: readonly VersionHeader[]): string[] {
  const cycles = new Set([today, addMonths(today, 1)])
  for (const header of headers) {
    if (header.startsOnCycle) cycles.add(header.startsOnCycle)
  }
  return [...cycles].sort()
}

function relation(cycleStart: string, today: string): "this" | "later" | "past" {
  if (cycleStart === today) return "this"
  return cycleStart > today ? "later" : "past"
}

function incomeProblem(rows: readonly IncomeForm[]): string | null {
  for (const row of rows) {
    const hasAmount = row.centsText.trim().length > 0
    const hasDate = row.expectedOn.trim().length > 0
    if (hasAmount && incomeMoney([row]).status === "pending") return "An income amount is incomplete. It is not treated as zero."
    if (hasAmount !== hasDate) return "Income needs both an amount and a date, or leave both unknown."
  }
  return null
}

function severityLabel(severity: CheckSeverity): string {
  switch (severity) {
    case "decision":
      return copy.needsDecision
    case "review":
      return copy.worthReviewing
    case "info":
      return copy.supporting
    case "unavailable":
      return copy.unavailableCheck
    default: {
      const unreachable: never = severity
      return unreachable
    }
  }
}

export function AgreementView({ initialCycle = "this" }: { initialCycle?: "this" | "next" }) {
  const today = currentCycle().start
  const [cycleStart, setCycleStart] = useState(() => (initialCycle === "next" ? addMonths(today, 1) : today))
  const [headers, setHeaders] = useState<VersionHeader[]>([])
  const [plans, setPlans] = useState<Map<string, StoredPlan>>(new Map())
  const [workspace, setWorkspace] = useState<CutoverWorkspace | null>(null)
  const [reviewItems, setReviewItems] = useState<boolean | null>(null)
  const [overview, setOverview] = useState<unknown | null>(null)
  const [liquidity, setLiquidity] = useState<unknown | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [mode, setMode] = useState<"read" | "edit">("read")
  const [reviewing, setReviewing] = useState(false)
  const [historicalId, setHistoricalId] = useState<string | null>(null)
  const [lines, setLines] = useState<PlanLine[]>([])
  const [income, setIncome] = useState<IncomeForm[]>([])
  const [sourceReferences, setSourceReferences] = useState<StoredPlan["sourceReferences"]>([])
  const [reason, setReason] = useState("")
  const [overrides, setOverrides] = useState<Map<string, PurposeGroup>>(new Map())
  const [draft, setDraft] = useState<Hold["receipt"]>(null)
  const [parentId, setParentId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [focusField, setFocusField] = useState<"contribution" | "target" | "payer" | null>(null)
  const [showAllChecks, setShowAllChecks] = useState(false)
  const [positionOpen, setPositionOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [checkingConflict, setCheckingConflict] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [prerequisiteHref, setPrerequisiteHref] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [conflict, setConflict] = useState<StoredPlan | null>(null)
  const [conflictKind, setConflictKind] = useState<"draft" | "published" | null>(null)
  const [committedScale, setCommittedScale] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const holdRef = useRef<Hold | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoadError(null)
    void Promise.all([loadHeaders(), loadCutover().catch(() => null), readReviewQueue(null).catch(() => null)])
      .then(async ([nextHeaders, cutover, review]) => {
        if (cancelled) return
        const applicable = applicablePublished(nextHeaders, cycleStart)
        const draftPick = selectDraft(nextHeaders, cycleStart)
        const ids = new Set<string>()
        if (applicable) ids.add(applicable.versionId)
        if (draftPick.status === "ready") ids.add(draftPick.draft.versionId)
        const nextPlans = new Map<string, StoredPlan>()
        for (const id of ids) nextPlans.set(id, readStoredPlan(await readVersion(id)))
        if (cancelled) return
        setHeaders(nextHeaders)
        setPlans(nextPlans)
        setWorkspace(cutover ? readCutover(cutover) : null)
        setReviewItems(reviewHasItems(review))
        setLoaded(true)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setLoadError(message(caught, copy.couldNotRead))
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [cycleStart, reloadKey])

  useEffect(() => {
    let cancelled = false
    void Promise.all([readOverview(cycleStart).catch(() => null), readLiquidity().catch(() => null)]).then(([nextOverview, nextLiquidity]) => {
      if (cancelled) return
      setOverview(nextOverview)
      setLiquidity(nextLiquidity)
    })
    return () => {
      cancelled = true
    }
  }, [cycleStart, reloadKey])

  useEffect(() => {
    if (!focusField || !expandedId) return
    const id = focusField === "contribution" ? `contribution-${expandedId}` : `purpose-${expandedId}-${focusField}`
    document.getElementById(id)?.focus()
  }, [expandedId, focusField, mode])

  const members: MemberRef[] = workspace?.members ?? []
  const memberIds = members.map((member) => member.id)
  const groupingKey = `budget-purpose-groups:${[...memberIds].sort().join(":") || "household"}`
  const [groupsReadyFor, setGroupsReadyFor] = useState<string | null>(null)
  useEffect(() => {
    let stored: Record<string, PurposeGroup> = {}
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(groupingKey) ?? "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, PurposeGroup>
    } catch {
      stored = {}
    }
    const valid = new Map(Object.entries(stored).filter((entry): entry is [string, PurposeGroup] => entry[1] === "bills" || entry[1] === "everyday" || entry[1] === "saved"))
    setOverrides(valid)
    setGroupsReadyFor(groupingKey)
  }, [groupingKey])
  useEffect(() => {
    if (groupsReadyFor !== groupingKey) return
    try {
      localStorage.setItem(groupingKey, JSON.stringify(Object.fromEntries(overrides)))
    } catch {
      // Keep the in-memory household grouping when browser storage is unavailable.
    }
  }, [groupingKey, groupsReadyFor, overrides])
  const applicable = applicablePublished(headers, cycleStart)
  const publishedPlan = applicable ? plans.get(applicable.versionId) ?? null : null
  const draftPick = selectDraft(headers, cycleStart)
  const draftPlan = draftPick.status === "ready" ? plans.get(draftPick.draft.versionId) ?? null : null
  const historicalPlan = historicalId ? plans.get(historicalId) ?? null : null
  const editing = mode === "edit" && !historicalPlan
  const shownLines = historicalPlan ? historicalPlan.lines : editing ? lines : (draftPlan ?? publishedPlan)?.lines ?? []
  const shownIncome = historicalPlan
    ? incomeFromPlan(historicalPlan.incomeAssumptions, memberIds)
    : editing
      ? income
      : incomeFromPlan((draftPlan ?? publishedPlan)?.incomeAssumptions ?? [], memberIds)
  const agreed = publishedPlan
    ? {
        income: incomeMoney(incomeFromPlan(publishedPlan.incomeAssumptions, memberIds)),
        contributions: contributionsInput(publishedPlan.lines.map((line) => line.contributionCents)),
      }
    : null
  const proposed = editing || draftPlan
    ? {
        income: incomeMoney(editing ? income : incomeFromPlan(draftPlan?.incomeAssumptions ?? [], memberIds)),
        contributions: contributionsInput((editing ? lines : draftPlan?.lines ?? []).map((line) => line.contributionCents)),
      }
    : null
  const capacity = projectCapacity({
    agreed: historicalPlan
      ? {
          income: incomeMoney(incomeFromPlan(historicalPlan.incomeAssumptions, memberIds)),
          contributions: contributionsInput(historicalPlan.lines.map((line) => line.contributionCents)),
        }
      : agreed,
    proposed: historicalPlan ? null : proposed,
    committedScaleCents: committedScale,
    commitScale: false,
  })
  const saved = savedFactsFromOverview(overview)
  const gap = capacity.status === "ready" ? capacity.rows.at(-1)?.gapCents ?? null : null
  const planning = Boolean(publishedPlan || draftPlan || editing || historicalPlan)
  const checks = planning ? projectChecks({
    today: localDateKey(new Date().toISOString()),
    incomeKnown: (editing ? incomeMoney(income) : incomeMoney(shownIncome)).status === "known",
    incomeIncomplete: (editing ? incomeMoney(income) : incomeMoney(shownIncome)).status === "missing",
    contributionsPending: contributionsInput(shownLines.map((line) => line.contributionCents)).status === "pending",
    gapCents: gap,
    lines: shownLines,
    groupOverrides: overrides,
    saved,
    reviewItems,
    historical: Boolean(historicalPlan),
  }) : []
  const visibleChecks = showAllChecks ? checks : leadChecks(checks)
  const cycleText = cycleLabel(cycleStart, addMonths(cycleStart, 1))
  const where = relation(cycleStart, today)
  const latest = latestPublished(headers)?.versionNumber ?? "0"
  const position = (() => {
    if (!overview) return null
    try {
      return projectBudget({
        overview,
        actuals: { entries: [] },
        liquidity: liquidity ?? {},
        members,
        filter: { kind: "household" },
      })
    } catch {
      return null
    }
  })()

  function commitScale() {
    const next = projectCapacity({ agreed, proposed, committedScaleCents: null, commitScale: true })
    if (next.status === "ready") setCommittedScale(next.scaleCents)
  }

  function announce(text: string) {
    setStatus(text)
    requestAnimationFrame(() => statusRef.current?.focus())
  }

  function beginEdit(source: StoredPlan | null, nextReason: string, receipt: Hold["receipt"]) {
    setLines(source ? cloneLines(source.lines) : [])
    setIncome(incomeFromPlan(source?.incomeAssumptions ?? [], memberIds.length > 0 ? memberIds : (source?.incomeAssumptions.map((entry) => entry.memberId) ?? [])))
    if (!source && memberIds.length > 0) setIncome(memberIds.map((id) => blankIncome(id)))
    setReason(source?.reason || nextReason)
    setSourceReferences(source?.sourceReferences ?? [])
    setDraft(receipt)
    setParentId(receipt ? source?.parentVersionId ?? publishedPlan?.versionId ?? null : publishedPlan?.versionId ?? null)
    setMode("edit")
    setReviewing(false)
    setConflict(null)
    setConflictKind(null)
    setHistoricalId(null)
  }

  function startEdit() {
    if (where === "past") return
    if (draftPlan?.draftRevision) {
      beginEdit(draftPlan, draftPlan.reason ?? "Revise this cycle", { versionId: draftPlan.versionId, draftRevision: draftPlan.draftRevision })
      return
    }
    const nextReason = where === "later" ? "Prepare the next cycle" : "Revise this cycle"
    beginEdit(publishedPlan, nextReason, null)
  }

  function startCreate() {
    setCycleStart(today)
    setLines([])
    setIncome(memberIds.map((id) => blankIncome(id)))
    setSourceReferences([])
    setReason(copy.createBudget)
    setDraft(null)
    setParentId(null)
    setConflict(null)
    setConflictKind(null)
    setMode("edit")
    setReviewing(false)
    setHistoricalId(null)
  }

  async function openHistorical(versionId: string) {
    setMode("read")
    try {
      if (!plans.has(versionId)) {
        const stored = readStoredPlan(await readVersion(versionId))
        setPlans((current) => new Map(current).set(versionId, stored))
      }
      setHistoricalId(versionId)
    } catch (caught) {
      setActionError(message(caught, copy.couldNotRead))
    }
  }

  function openCheck(check: BudgetCheck) {
    if (check.target.kind === "position") {
      setPositionOpen(true)
      document.getElementById("current-funding")?.focus()
      return
    }
    if (check.target.kind === "income") {
      if (!historicalPlan && mode === "read" && where !== "past") startEdit()
      document.getElementById("expected-income")?.focus()
      return
    }
    if (check.target.kind === "contributions") {
      if (!historicalPlan && mode === "read" && where !== "past") startEdit()
      document.getElementById("our-plan")?.focus()
      return
    }
    if (check.target.kind !== "row") return
    if (!historicalPlan && mode === "read" && where !== "past") startEdit()
    setExpandedId(check.target.stableLineId)
    setFocusField(check.target.field)
  }

  async function rememberConflict(raw: string) {
    const nextHeaders = await loadHeaders()
    setHeaders(nextHeaders)
    const id = draft?.versionId
    if (id && !raw.includes("latest version")) {
      const currentDraft = readStoredPlan(await readVersion(id))
      if (currentDraft.state === "draft") {
        setConflict(currentDraft)
        setConflictKind("draft")
        setPlans((current) => new Map(current).set(currentDraft.versionId, currentDraft))
        if (currentDraft.draftRevision) setDraft({ versionId: currentDraft.versionId, draftRevision: currentDraft.draftRevision })
        return
      }
    }
    const nextApplicable = applicablePublished(nextHeaders, cycleStart)
    if (!nextApplicable) {
      setActionError("Your edits are still here, but this cycle has no published agreement to compare. Reload before continuing.")
      return
    }
    const newer = readStoredPlan(await readVersion(nextApplicable.versionId))
    setPlans((current) => new Map(current).set(newer.versionId, newer))
    setConflict(newer)
    setConflictKind("published")
    if (raw.includes("draft published")) setDraft(null)
  }

  function rememberDraft(receipt: { versionId: string; draftRevision: string }) {
    const assumptions = incomePayload(income)
    const header: VersionHeader = {
      versionId: receipt.versionId,
      state: "draft",
      versionNumber: null,
      startsOnCycle: cycleStart,
      draftRevision: receipt.draftRevision,
      parentVersionId: parentId,
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
    }
    setHeaders((current) => [header, ...current.filter((item) => item.versionId !== header.versionId)])
    setPlans((current) => new Map(current).set(receipt.versionId, {
      versionId: receipt.versionId,
      state: "draft",
      versionNumber: null,
      draftRevision: receipt.draftRevision,
      parentVersionId: parentId,
      reason: reason.trim(),
      startsOnCycle: cycleStart,
      lines: cloneLines(lines),
      incomeAssumptions: assumptions,
      sourceReferences,
    }))
    setDraft(receipt)
  }

  function saveHold(): Hold {
    const fingerprint = JSON.stringify({ cycleStart, reason: reason.trim(), lines, income: incomePayload(income), sourceReferences, parentId, latest })
    const previous = holdRef.current
    if (previous && previous.fingerprint === fingerprint) return previous
    return {
      fingerprint,
      save: holdCommand(null, {
        name: "budget_save_draft_v1",
        fingerprint,
        payload: buildDraftPayload({
          draftId: draft?.versionId,
          expectedDraftRevision: draft?.draftRevision,
          parentVersionId: parentId ?? undefined,
          startsOnCycle: cycleStart,
          reason,
          lines: toDraftLines(lines),
          incomeAssumptions: incomePayload(income),
          sourceReferences,
        }),
      }, newCommandId),
      receipt: draft,
      publishId: previous?.publishId ?? newCommandId(),
      uncertain: false,
      phase: "save",
    }
  }

  async function persist(hold: Hold): Promise<Hold> {
    const receipt = readDraftReceipt(await writeBudgetRpc(hold.save.name, hold.save.id, hold.save.payload))
    const next = { ...hold, receipt, uncertain: false }
    holdRef.current = next
    rememberDraft(receipt)
    return next
  }

  function failSave(hold: Hold, caught: unknown) {
    const raw = commandFailureText(caught)
    if (raw.includes("budget_stale")) {
      setCheckingConflict(true)
      void rememberConflict(raw)
        .catch(() => setActionError("Your edits are still here, but the changed agreement could not be loaded. Reload before continuing."))
        .finally(() => setCheckingConflict(false))
      setActionError(copy.numbersChanged)
      holdRef.current = null
    } else if (commandFailureIsUncertain(raw)) {
      holdRef.current = { ...hold, uncertain: true }
      setActionError(copy.retryOutstandingMovement)
    } else {
      holdRef.current = null
      const incomplete = raw.includes("budget_incomplete")
      setPrerequisiteHref(incomplete && (raw.includes("reconcil") || raw.includes("cutover")) ? "/budget/reconcile" : null)
      setActionError(incomplete ? "A publication prerequisite is missing. The draft is kept." : message(caught, copy.couldNotSave))
    }
    announce("The draft could not be saved. Your edits are still here.")
  }

  async function onSave(): Promise<boolean> {
    if (pendingRef.current || checkingConflict) return false
    if (holdRef.current?.uncertain && holdRef.current.phase === "publish") {
      setActionError(copy.retryOutstandingMovement)
      return false
    }
    const problem = incomeProblem(income)
    if (problem || !contributionsReady(lines) || !reason.trim()) {
      setActionError(problem ?? (lines.length === 0 ? "Add a purpose before saving. A draft cannot be stored without one." : "A contribution or the reason is incomplete. An incomplete amount is not treated as zero."))
      return false
    }
    const hold = holdRef.current?.uncertain ? holdRef.current : saveHold()
    holdRef.current = hold
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    try {
      await persist(hold)
      announce("Draft saved.")
      return true
    } catch (caught) {
      failSave(hold, caught)
      return false
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  async function onPublish() {
    if (pendingRef.current || checkingConflict) return
    const problem = incomeProblem(income)
    if (!holdRef.current?.uncertain && (problem || !contributionsReady(lines) || !reason.trim())) {
      setActionError(problem ?? copy.publishReason)
      return
    }
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    let hold = holdRef.current?.uncertain ? holdRef.current : saveHold()
    try {
      if (!hold.receipt || hold.phase === "save") {
        hold = await persist(hold)
      }
      const receipt = hold.receipt
      if (!receipt) throw new Error(copy.couldNotSave)
      const payload = buildPublishPayload({
        draftId: receipt.versionId,
        expectedDraftRevision: receipt.draftRevision,
        expectedParentVersionId: parentId ?? undefined,
        expectedLatestVersionNumber: latest,
        reason,
      })
      const publish = holdCommand(
        hold.phase === "publish" ? { id: hold.publishId, name: "budget_publish_v1", fingerprint: hold.fingerprint, payload } : null,
        { name: "budget_publish_v1", fingerprint: hold.fingerprint, payload },
        () => hold.publishId,
      )
      holdRef.current = { ...hold, phase: "publish", uncertain: false }
      const published = readPublishReceipt(await writeBudgetRpc(publish.name, publish.id, publish.payload))
      holdRef.current = null
      setMode("read")
      setReviewing(false)
      const sentence = publishedSentence(published.versionNumber, cycleText)
      setNotice(sentence)
      announce(sentence)
      setReloadKey((key) => key + 1)
    } catch (caught) {
      const raw = commandFailureText(caught)
      if (commandFailureIsUncertain(raw)) {
        holdRef.current = { ...hold, uncertain: true, phase: hold.receipt ? "publish" : "save" }
        setActionError(copy.retryOutstandingMovement)
        announce("Publish failed. Your draft is still here.")
      } else {
        failSave(hold, caught)
      }
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  async function onCreate(name: string, group: PurposeGroup, kind: PlanLine["kind"]) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await writeBudgetRpc("budget_create_fund_v1", newCommandId(), buildCreateFundPayload({ name, beneficiaryScope: "shared" }))
      const fundId = readString(readRecord(result) ?? {}, "fund_id")
      if (!fundId) throw new Error(copy.couldNotSave)
      const created = blankLine({ fundId, name, stableLineId: crypto.randomUUID() })
      const funding = startingFunding(group, kind)
      setLines((current) => [...current, { ...created, ...funding, contributionCents: "" }])
      setOverrides((current) => new Map(current).set(created.stableLineId, group))
      setExpandedId(created.stableLineId)
    } catch (caught) {
      setActionError(message(caught, copy.couldNotSave))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  function onAddFund(fund: CutoverFund) {
    const created = blankLine({ fundId: fund.id, name: fund.name, stableLineId: crypto.randomUUID() })
    setLines((current) => [...current, { ...created, contributionCents: "" }])
    setExpandedId(created.stableLineId)
  }

  const statusLine = historicalPlan
    ? `Historical agreement · Version ${historicalPlan.versionNumber ?? "—"}`
    : editing
      ? `Draft · ${where === "later" ? "Preparing a later cycle" : "Revising this cycle"}`
      : draftPlan
        ? `Draft saved · revision ${draftPlan.draftRevision ?? "—"}`
        : publishedPlan
          ? `Published · Version ${publishedPlan.versionNumber}`
          : "No budget"

  return (
    <div className="@container/budget space-y-8 pb-8" aria-busy={pending}>
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              onValueChange={(next) => {
                setHistoricalId(null)
                setMode("read")
                setCycleStart(next)
              }}
              value={cycleStart}
            >
              <SelectTrigger aria-label="Budget cycle" className={`w-44 ${CONTROL}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {cycleOptions(today, headers).map((cycle) => (
                  <SelectItem key={cycle} value={cycle}>{cycleLabel(cycle, addMonths(cycle, 1))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(next) => {
                if (next === "current") setHistoricalId(null)
                else void openHistorical(next)
              }}
              value={historicalId ?? "current"}
            >
              <SelectTrigger aria-label={copy.versionHistory} className={`w-44 ${CONTROL}`}><SelectValue placeholder={copy.versionHistory} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current cycle</SelectItem>
                {headers.filter((header) => header.state === "published" && header.versionNumber).map((header) => (
                  <SelectItem key={header.versionId} value={header.versionId}>
                    Version {header.versionNumber}{header.startsOnCycle ? ` · ${header.startsOnCycle}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {historicalPlan ? (
              <Button className={CONTROL} onClick={() => { setHistoricalId(null); setCycleStart(today) }} type="button">Return to this cycle</Button>
            ) : editing ? (
              <Button className={CONTROL} onClick={() => { setReviewing(true); commitScale(); document.getElementById("review-changes")?.scrollIntoView({ block: "nearest" }) }} type="button">{copy.reviewChanges}</Button>
            ) : draftPlan ? (
              <Button className={CONTROL} onClick={startEdit} type="button">{copy.resumeDraft}</Button>
            ) : publishedPlan && where !== "past" ? (
              <Button className={CONTROL} onClick={startEdit} type="button">{copy.editBudget}</Button>
            ) : !publishedPlan && where === "this" ? (
              <Button className={CONTROL} onClick={startCreate} type="button">{copy.createBudget}</Button>
            ) : (
              <Button className={CONTROL} onClick={() => setCycleStart(today)} type="button">Return to this cycle</Button>
            )}
          </div>
        }
        description={statusLine}
        title={copy.pageTitle}
      />
      <p className="type-body">{cycleText}. {where === "later" ? "Preparing a later cycle does not change this one." : null}</p>
      <p className="sr-only" ref={statusRef} role="status" tabIndex={-1}>{status}</p>
      {status ? <p className="type-body">{status}</p> : null}
      {notice ? (
        <p className="type-body text-success">
          {notice}{" "}
          <Link className="underline underline-offset-4" href="/budget">View the agreement</Link>
        </p>
      ) : null}
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.couldNotSave}</AlertTitle>
          <AlertDescription>
            {actionError}
            {prerequisiteHref ? <> <Link className="underline underline-offset-4" href={prerequisiteHref}>Open the missing step</Link></> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {draftPick.status === "ambiguous" ? (
        <Alert>
          <AlertDescription>More than one draft exists for this cycle, and their save times could not be compared. No draft was chosen.</AlertDescription>
        </Alert>
      ) : null}
      {!loaded && !loadError ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {loaded && !publishedPlan && !draftPlan && !editing && where === "this" ? (
        <div className="space-y-3">
          <h2 className="type-section-title">{copy.createBudget}</h2>
          <p className="type-body max-w-2xl">Create this cycle&apos;s budget for {cycleText}. This does not move money, and it does not import a spreadsheet.</p>
          <Button className={CONTROL} onClick={startCreate} type="button">{copy.createBudget}</Button>
        </div>
      ) : null}
      {publishedPlan && publishedPlan.startsOnCycle !== cycleStart ? (
        <p className="type-body-small text-muted-foreground">Carried from {cycleLabel(publishedPlan.startsOnCycle, addMonths(publishedPlan.startsOnCycle, 1))}. Publishing creates a version for this cycle.</p>
      ) : null}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-8">
          {publishedPlan || draftPlan || editing || historicalPlan ? (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-6">
              <p><span className="type-caption block text-muted-foreground">Income planned</span><span className="type-numeric">{capacity.status === "ready" ? formatCents(capacity.rows.at(-1)?.incomeCents ?? null) : "—"}</span></p>
              <p><span className="type-caption block text-muted-foreground">Contributions</span><span className="type-numeric">{capacity.status === "ready" ? formatCents(capacity.rows.at(-1)?.contributionsCents ?? null) : "—"}</span></p>
              <p><span className="type-caption block text-muted-foreground">Plan gap</span><span className="type-numeric">{capacity.status === "ready" ? capacity.rows.at(-1)?.readout.split("—")[1] : "—"}</span></p>
            </div>
            <p className="type-body-small text-muted-foreground">{copy.planCompares}</p>
            <PlanCapacityChart capacity={capacity} />
          </section>
          ) : null}

          {planning ? <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="type-section-title">{copy.budgetChecks}</h2>
              <Button className={CONTROL} onClick={() => setShowAllChecks((value) => !value)} type="button" variant="outline">
                {showAllChecks ? "Show fewer checks" : copy.viewAllChecks}
              </Button>
            </div>
            {!issuesFound(checks) ? <p className="type-body">{copy.noIssues}</p> : null}
            <ul className="space-y-3">
              {visibleChecks.map((check) => (
                <li className={check.severity === "decision" ? "rounded-lg bg-warning/10 px-3 py-3" : "py-2"} key={check.id}>
                  <p className="type-body">
                    {check.severity === "decision" ? <TriangleAlert aria-hidden className="mr-2 inline size-4 text-warning" /> : null}
                    {check.severity === "info" ? <Info aria-hidden className="mr-2 inline size-4 text-info" /> : null}
                    <span className="type-label">{severityLabel(check.severity)}</span> · {check.title}
                  </p>
                  <p className="type-body-small mt-1 text-muted-foreground">{check.why} {check.evidence}</p>
                  {check.target.kind === "none" ? null : check.target.kind === "review" && editing ? (
                    <Button className={`${CONTROL} mt-2`} onClick={() => setActionError("Save the draft before opening purchases, so this page can restore it.")} type="button" variant="outline">{check.action}</Button>
                  ) : check.target.kind === "review" ? (
                    <Button asChild className={`${CONTROL} mt-2`} variant="outline">
                      <Link href="/budget/review">{check.action}</Link>
                    </Button>
                  ) : (
                    <Button className={`${CONTROL} mt-2`} onClick={() => openCheck(check)} type="button" variant="outline">{check.action}</Button>
                  )}
                </li>
              ))}
            </ul>
          </section> : null}

          <IncomeFields editing={editing} members={members} onChange={setIncome} onCommitScale={commitScale} rows={shownIncome} />
          <AgreementPlan
            accounts={workspace?.accounts ?? []}
            categories={workspace?.categories ?? []}
            editing={editing}
            expandedId={expandedId}
            funds={workspace?.funds ?? []}
            historical={Boolean(historicalPlan)}
            lines={shownLines}
            members={members}
            onAddFund={onAddFund}
            onCommitScale={commitScale}
            onCreate={(nextName, group, kind) => void onCreate(nextName, group, kind)}
            onExpand={setExpandedId}
            onLines={setLines}
            onOverrides={setOverrides}
            overrides={overrides}
            publishedLines={publishedPlan?.lines ?? []}
            saved={historicalPlan ? null : saved}
          />

          <section className="space-y-3" id="current-funding" tabIndex={-1}>
            <Button className={CONTROL} onClick={() => setPositionOpen((value) => !value)} type="button" variant="outline">
              {positionOpen ? "Hide current funding" : copy.viewFunding}
            </Button>
            {positionOpen ? (
              <div className="space-y-3">
                <p className="type-body-small text-muted-foreground">
                  {historicalPlan ? "These balances are now, not the historical agreement. " : null}
                  {position?.asOfLabel ?? "Current position was not read."} A bank transfer is not done here, and it is not a move between purposes. The app does not infer a debt between people.
                </p>
                {position ? (
                  <ul className="space-y-2">
                    {position.accounts.map((account) => (
                      <li key={account.id}>{account.label}: <span className="type-numeric">{account.amount}</span></li>
                    ))}
                    {position.restrictedBacking.map((account) => (
                      <li key={`restricted-${account.id}`}>{account.label}: <span className="type-numeric">{account.amount}</span>. Restricted, not the paying account.</li>
                    ))}
                  </ul>
                ) : <p className="type-body">Current funding could not be read. The plan can still be edited.</p>}
                <MoveMoneyDialog
                  canAssign={position?.canAssign ?? false}
                  funds={(position ? [...position.purposes, ...position.commitments] : []).map((row) => ({ id: row.fundId, name: row.name, balanceLabel: row.available }))}
                  onSaved={() => setReloadKey((key) => key + 1)}
                  reconciliationFingerprint={position?.reconciliationFingerprint ?? null}
                  reconciliationId={position?.reconciliationId ?? null}
                  versionId={position?.versionId ?? null}
                />
                <p className="type-caption text-muted-foreground">
                  <Link className="underline underline-offset-4" href="/budget/liquidity">Cash in each account</Link>
                  {" · "}
                  <Link className="underline underline-offset-4" href="/budget/reconcile">{copy.reconcile}</Link>
                </p>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-6" id="review-changes">
          <h2 className="type-section-title">{editing ? "Change summary" : "This cycle"}</h2>
          {conflict ? (
            <div className="space-y-2">
              <p className="type-body">
                {conflictKind === "draft"
                  ? "Another edit was saved to this draft. Your edits are still here."
                  : `Version ${conflict.versionNumber} is now the applicable published agreement. Your edits are still here.`}
              </p>
              <p className="type-caption text-muted-foreground">Saved agreement · {conflict.lines.length} purposes · {conflict.incomeAssumptions.length} income assumptions · {conflict.sourceReferences.length} references</p>
              <ul className="space-y-1" aria-label="Saved agreement purpose comparison">
                {planDiff(conflict.lines, lines).filter((row) => !row.unchanged).map((row) => <li key={row.stableLineId}>{row.text}</li>)}
              </ul>
              <ul className="space-y-1" aria-label="Saved agreement income assumptions">
                {conflict.incomeAssumptions.map((entry, index) => (
                  <li key={`${entry.memberId}-${entry.expectedOn}-${index}`}>{memberName(members, entry.memberId) ?? "Household member"}: {formatCents(entry.expectedNetCents)} on {entry.expectedOn} · {entry.provenance}</li>
                ))}
              </ul>
              <p className="type-caption text-muted-foreground">Your version · {lines.length} purposes · {incomePayload(income).length} income assumptions · {sourceReferences.length} references</p>
              <ul className="space-y-1" aria-label="Your income assumptions">
                {incomePayload(income).map((entry, index) => (
                  <li key={`${entry.memberId}-${entry.expectedOn}-${index}`}>{memberName(members, entry.memberId) ?? "Household member"}: {formatCents(entry.expectedNetCents)} on {entry.expectedOn} · {entry.provenance}</li>
                ))}
              </ul>
              <Button className={CONTROL} onClick={() => {
                if (conflictKind === "published") {
                  setParentId(conflict.versionId)
                } else if (conflict.draftRevision) {
                  setDraft({ versionId: conflict.versionId, draftRevision: conflict.draftRevision })
                  setParentId(conflict.parentVersionId)
                }
                holdRef.current = null
                setConflict(null)
                setConflictKind(null)
              }} type="button" variant="outline">Keep my edits against this version</Button>
              <Button className={CONTROL} onClick={() => {
                setLines(cloneLines(conflict.lines))
                setIncome(incomeFromPlan(conflict.incomeAssumptions, memberIds))
                setSourceReferences(conflict.sourceReferences)
                setReason(conflict.reason ?? reason)
                if (conflictKind === "published") {
                  setParentId(conflict.versionId)
                } else if (conflict.draftRevision) {
                  setDraft({ versionId: conflict.versionId, draftRevision: conflict.draftRevision })
                  setParentId(conflict.parentVersionId)
                }
                holdRef.current = null
                setConflict(null)
                setConflictKind(null)
              }} type="button" variant="outline">Use this saved version</Button>
            </div>
          ) : null}
          <ul className="space-y-2">
            {planDiff(publishedPlan?.lines ?? [], editing ? lines : shownLines).filter((row) => !row.unchanged).map((row) => (
              <li key={row.stableLineId}>{row.text}</li>
            ))}
          </ul>
          {editing ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="revision-reason">Reason for revision</Label>
                <Textarea id="revision-reason" onChange={(event) => setReason(event.target.value)} value={reason} />
              </div>
              <p className="type-caption text-muted-foreground">{copy.contributionNotMove} Cash balances are not part of these totals.</p>
              <div className="flex flex-wrap gap-2">
                <Button className={CONTROL} disabled={pending || checkingConflict} onClick={() => void onSave()} type="button" variant="outline">{copy.saveDraft}</Button>
                <Button
                  className={CONTROL}
                  onClick={() => {
                    if (holdRef.current?.uncertain) {
                      setActionError(copy.retryOutstandingMovement)
                      return
                    }
                    setMode("read")
                    setReviewing(false)
                    announce(copy.discardNotStored)
                  }}
                  type="button"
                  variant="outline"
                >
                  {copy.discardDraft}
                </Button>
              </div>
              {reviewing ? (
                <Button className={CONTROL} disabled={pending || checkingConflict} onClick={() => void onPublish()} type="button">{copy.publishBudget}</Button>
              ) : null}
              <p className="type-caption text-muted-foreground">{where === "later" ? `Effective cycle ${cycleText}. This does not change the current cycle.` : `Effective cycle ${cycleText}.`}</p>
            </>
          ) : (
            <p className="type-body-small text-muted-foreground">{draftPlan ? `Resume the draft for ${cycleText}.` : "Edit the budget to propose a change."}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
