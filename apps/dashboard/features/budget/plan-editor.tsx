"use client"

import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildCreateFundPayload, buildDraftPayload, buildMoveFundsPayload, buildPublishPayload, newCommandId } from "@/domain/budget/commands"
import { copy } from "@/domain/budget/copy"
import { readCutover, type CutoverWorkspace } from "@/domain/budget/cutover"
import { addMonths, currentCycle, cycleLabel } from "@/domain/budget/cycle"
import { memberName } from "@/domain/budget/members"
import { centsToRandsInput, isCents } from "@/domain/budget/money"
import { moveReason, randsToCents } from "@/domain/budget/move"
import { localDateKey } from "@/lib/format/date"
import {
  blankLine,
  chosenStartsOn,
  cloneLines,
  latestPublished,
  planDiff,
  publishReady,
  readDraftReceipt,
  readPublishedPlan,
  readVersionPage,
  replaceLine,
  toDraftLines,
  type CycleChoice,
  type DraftReceipt,
  type PlanLine,
  type PublishedPlan,
  type VersionHeader,
} from "@/domain/budget/plan"
import { readCutover as loadCutover, readVersion, readVersions, writeBudgetRpc } from "./rpc"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"
const DRAFT_MAY_EXIST = "The draft may exist and the plan was not published."

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

async function loadPublishedPlan(): Promise<PublishedPlan | null> {
  const headers: VersionHeader[] = []
  let cursor: string | null = null
  do {
    const page = readVersionPage(await readVersions(cursor))
    headers.push(...page.versions)
    if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error(copy.couldNotRead)
    cursor = page.nextCursor
  } while (cursor)
  const latest = latestPublished(headers)
  if (!latest) return null
  return readPublishedPlan(await readVersion(latest.versionId))
}

export function PlanEditor() {
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [publishFailed, setPublishFailed] = useState(false)
  const [published, setPublished] = useState<PublishedPlan | null>(null)
  const [lines, setLines] = useState<PlanLine[]>([])
  const [choice, setChoice] = useState<CycleChoice>("this")
  const [reason, setReason] = useState("")
  const [draft, setDraft] = useState<DraftReceipt | null>(null)
  const [workspace, setWorkspace] = useState<CutoverWorkspace | null>(null)
  const [moveMoney, setMoveMoney] = useState(false)
  const [moveAmount, setMoveAmount] = useState("")
  const [moveFrom, setMoveFrom] = useState("")
  const [moveTo, setMoveTo] = useState("")
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoadError(null)
    void Promise.all([loadPublishedPlan(), loadCutover().catch(() => null)])
      .then(([next, cutover]) => {
        if (cancelled) return
        setPublished(next)
        setWorkspace(cutover ? readCutover(cutover) : null)
        setLines(next ? cloneLines(next.lines) : [])
        setChoice("this")
        setReason("")
        setDraft(null)
        setActionError(null)
        setPublishFailed(false)
        setLoaded(true)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setPublished(null)
        setLines([])
        setLoadError(message(caught, copy.couldNotRead))
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function onCreateFund(name: string) {
    const trimmed = name.trim()
    if (!trimmed || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await writeBudgetRpc("budget_create_fund_v1", newCommandId(), buildCreateFundPayload({
        name: trimmed,
        beneficiaryScope: "shared",
      }))
      const record = result && typeof result === "object" ? (result as { fund_id?: string }) : null
      const fundId = record?.fund_id
      if (!fundId) throw new Error(copy.couldNotSave)
      setLines((current) => [...current, blankLine({ fundId, name: trimmed, stableLineId: crypto.randomUUID() })])
    } catch (caught) {
      setActionError(message(caught, copy.couldNotSave))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  async function onPublish() {
    if (!publishReady(reason, lines) || pendingRef.current) return
    const startsOnCycle = chosenStartsOn(published?.startsOnCycle ?? currentCycle().start, choice)
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    setPublishFailed(false)
    try {
      const saved = readDraftReceipt(
        await writeBudgetRpc(
          "budget_save_draft_v1",
          newCommandId(),
          buildDraftPayload({
            draftId: draft?.versionId,
            expectedDraftRevision: draft?.draftRevision,
            parentVersionId: published?.versionId,
            startsOnCycle,
            reason,
            lines: toDraftLines(lines),
            incomeAssumptions: published?.incomeAssumptions ?? [],
            sourceReferences: published?.sourceReferences ?? [],
          }),
        ),
      )
      setDraft(saved)
      try {
        const publishedResult = await writeBudgetRpc(
          "budget_publish_v1",
          newCommandId(),
          buildPublishPayload({
            draftId: saved.versionId,
            expectedDraftRevision: saved.draftRevision,
            expectedParentVersionId: published?.versionId,
            expectedLatestVersionNumber: published?.versionNumber ?? 0,
            reason,
          }),
        )
        if (moveMoney) {
          const cents = randsToCents(moveAmount)
          const versionId = publishedResult && typeof publishedResult === "object" ? (publishedResult as { version_id?: string }).version_id : null
          const reconciliation = workspace?.reconciliation
          if (!cents || !moveFrom || !moveTo || moveFrom === moveTo || !versionId || !reconciliation?.fingerprint) {
            throw new Error(`${copy.couldNotSave} The version was published. The money was not moved.`)
          }
          await writeBudgetRpc("budget_move_funds_v1", newCommandId(), buildMoveFundsPayload({
            kind: "reallocate",
            fromFundId: moveFrom,
            toFundId: moveTo,
            amountCents: cents,
            effectiveOn: localDateKey(new Date().toISOString()),
            expectedVersionId: versionId,
            expectedReconciliationId: reconciliation.id,
            expectedReconciliationFingerprint: reconciliation.fingerprint,
            reason: moveReason("reallocate"),
          }))
        }
      } catch (caught) {
        setPublishFailed(true)
        setActionError(message(caught, copy.couldNotSave))
        return
      }
      setPublished(null)
      setLines([])
      setLoaded(false)
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setActionError(message(caught, copy.couldNotSave))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader title={copy.editPlan} />
      {loadError ? (
        <Alert>
          <AlertTitle>{copy.couldNotRead}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert>
          <AlertTitle>{copy.couldNotSave}</AlertTitle>
          <AlertDescription>
            {actionError}
            {publishFailed ? ` ${DRAFT_MAY_EXIST}` : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {!loaded && !loadError ? <p className="type-body text-muted-foreground">Reading the budget.</p> : null}
      {loaded && !loadError && !published ? (
        <Alert>
          <AlertTitle>{copy.noPublishedPlan}</AlertTitle>
          <AlertDescription>Create the first plan here. Publishing it does not assign opening cash.</AlertDescription>
        </Alert>
      ) : null}
      {loaded && !loadError ? (
        <PlanBody
          choice={choice}
          lines={lines}
          moveAmount={moveAmount}
          moveFrom={moveFrom}
          moveMoney={moveMoney}
          moveTo={moveTo}
          pending={pending}
          published={published}
          reason={reason}
          workspace={workspace}
          onChoice={setChoice}
          onCreateFund={(name) => void onCreateFund(name)}
          onLines={setLines}
          onMoveAmount={setMoveAmount}
          onMoveFrom={setMoveFrom}
          onMoveMoney={setMoveMoney}
          onMoveTo={setMoveTo}
          onPublish={() => void onPublish()}
          onReason={setReason}
        />
      ) : null}
    </div>
  )
}

function PlanBody({
  choice,
  lines,
  moveAmount,
  moveFrom,
  moveMoney,
  moveTo,
  onChoice,
  onCreateFund,
  onLines,
  onMoveAmount,
  onMoveFrom,
  onMoveMoney,
  onMoveTo,
  onPublish,
  onReason,
  pending,
  published,
  reason,
  workspace,
}: {
  choice: CycleChoice
  lines: PlanLine[]
  moveAmount: string
  moveFrom: string
  moveMoney: boolean
  moveTo: string
  onChoice: (choice: CycleChoice) => void
  onCreateFund: (name: string) => void
  onLines: (lines: PlanLine[]) => void
  onMoveAmount: (value: string) => void
  onMoveFrom: (value: string) => void
  onMoveMoney: (value: boolean) => void
  onMoveTo: (value: string) => void
  onPublish: () => void
  onReason: (reason: string) => void
  pending: boolean
  published: PublishedPlan | null
  reason: string
  workspace: CutoverWorkspace | null
}) {
  const [fundName, setFundName] = useState("")
  const startsOn = chosenStartsOn(published?.startsOnCycle ?? currentCycle().start, choice)
  const diff = planDiff(published?.lines ?? [], lines)
  const ready = publishReady(reason, lines)
  const reasonMissing = reason.trim().length === 0

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="type-label text-muted-foreground">{cycleLabel(startsOn, addMonths(startsOn, 1))}</p>
        <ToggleGroup
          aria-label={`${copy.thisCycle} ${copy.nextCycleChoice}`}
          onValueChange={(next) => {
            if (next === "this" || next === "next") onChoice(next)
          }}
          size="sm"
          spacing={0}
          type="single"
          value={choice}
          variant="outline"
        >
          <ToggleGroupItem className={TOUCH} value="this">
            {copy.thisCycle}
          </ToggleGroupItem>
          <ToggleGroupItem className={TOUCH} value="next">
            {copy.nextCycleChoice}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Section title={copy.revisedPlan}>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateFund(fundName)
            setFundName("")
          }}
        >
          <Input aria-label="New purpose" onChange={(event) => setFundName(event.target.value)} value={fundName} />
          <Button type="submit" variant="outline">Add purpose</Button>
        </form>
        <ul className="divide-y rounded-lg border">
          {lines.map((line) => {
            const invalid = !isCents(line.contributionCents) || line.contributionCents.startsWith("-")
            return (
              <li className="space-y-2 px-4 py-3" key={line.stableLineId}>
                <label className="block space-y-2" htmlFor={`plan-line-${line.stableLineId}`}>
                  <span className="block">{line.name}</span>
                  <ContributionField
                    invalid={invalid}
                    line={line}
                    lines={lines}
                    onLines={onLines}
                  />
                </label>
                <AgreementFields line={line} lines={lines} onLines={onLines} workspace={workspace} />
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={copy.originalPlan}>
        {diff.length > 0 && diff.every((row) => row.unchanged) ? (
          <p className="type-caption text-muted-foreground">{copy.planUnchanged}</p>
        ) : null}
        <ul className="space-y-2">
          {diff.map((row) => (
            <li className="type-numeric" key={row.stableLineId}>
              {row.text}
            </li>
          ))}
        </ul>
      </Section>

      <div className="space-y-3">
        <Textarea aria-label={copy.publishReason} onChange={(event) => onReason(event.target.value)} value={reason} />
        {reasonMissing ? (
          <Alert id="plan-publish-reason">
            <AlertDescription>{copy.publishReason}</AlertDescription>
          </Alert>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input checked={moveMoney} onChange={(event) => onMoveMoney(event.target.checked)} type="checkbox" />
          Also move already-saved money. Changing a contribution does not do this.
        </label>
        {moveMoney ? (
          <div className="grid gap-2">
            <Select onValueChange={(next) => { if (next) onMoveFrom(next) }} value={moveFrom || undefined}>
              <SelectTrigger aria-label="From purpose"><SelectValue placeholder="From purpose" /></SelectTrigger>
              <SelectContent>
                {lines.map((line) => <SelectItem key={line.fundId} value={line.fundId}>{line.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(next) => { if (next) onMoveTo(next) }} value={moveTo || undefined}>
              <SelectTrigger aria-label="To purpose"><SelectValue placeholder="To purpose" /></SelectTrigger>
              <SelectContent>
                {lines.map((line) => <SelectItem key={`to-${line.fundId}`} value={line.fundId}>{line.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input aria-label="Amount" onChange={(event) => onMoveAmount(event.target.value)} value={moveAmount} />
            <p className="type-caption text-muted-foreground">{moveReason("reallocate")}. {copy.planUnchanged}</p>
          </div>
        ) : null}
        <Button
          aria-describedby={reasonMissing ? "plan-publish-reason" : undefined}
          disabled={!ready || pending}
          onClick={onPublish}
          type="button"
        >
          {reasonMissing ? copy.publishReason : "Publish"}
        </Button>
      </div>
    </>
  )
}

function ContributionField({
  invalid,
  line,
  lines,
  onLines,
}: {
  invalid: boolean
  line: PlanLine
  lines: PlanLine[]
  onLines: (lines: PlanLine[]) => void
}) {
  const [text, setText] = useState(() =>
    isCents(line.contributionCents) ? centsToRandsInput(line.contributionCents) : line.contributionCents,
  )
  return (
    <Input
      aria-invalid={invalid}
      autoComplete="off"
      className="type-numeric"
      id={`plan-line-${line.stableLineId}`}
      inputMode="decimal"
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const cents = randsToCents(next)
        onLines(replaceLine(lines, line.stableLineId, { contributionCents: cents ?? next }))
      }}
      value={text}
    />
  )
}

function AgreementFields({
  line,
  lines,
  onLines,
  workspace,
}: {
  line: PlanLine
  lines: PlanLine[]
  onLines: (lines: PlanLine[]) => void
  workspace: CutoverWorkspace | null
}) {
  function patch(next: Partial<PlanLine>) {
    onLines(replaceLine(lines, line.stableLineId, next))
  }
  return (
    <details>
      <summary className="type-caption cursor-pointer text-muted-foreground">Agreement</summary>
      <div className="mt-2 grid gap-2">
        <Input aria-label={copy.beneficiary} onChange={(event) => patch({ beneficiaryScope: event.target.value === "member" ? "member" : "shared", beneficiaryMemberId: event.target.value === "member" ? line.beneficiaryMemberId : null })} value={line.beneficiaryScope} />
        <Select onValueChange={(next) => patch({ beneficiaryMemberId: next || null, beneficiaryScope: next ? "member" : "shared" })} value={line.beneficiaryMemberId ?? undefined}>
          <SelectTrigger aria-label={copy.beneficiary}><SelectValue placeholder={copy.shared} /></SelectTrigger>
          <SelectContent>
            {(workspace?.members ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{memberName(workspace?.members ?? [], member.id)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select onValueChange={(next) => patch({ plannedPayerMemberId: next || null })} value={line.plannedPayerMemberId ?? undefined}>
          <SelectTrigger aria-label={copy.plannedPayer}><SelectValue placeholder={copy.plannedPayer} /></SelectTrigger>
          <SelectContent>
            {(workspace?.members ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{memberName(workspace?.members ?? [], member.id)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select onValueChange={(next) => {
          if (next === "cycle_allowance" || next === "accumulating" || next === "target_by_date" || next === "reserve_target") {
            patch({ fundingBehaviour: next })
          }
        }} value={line.fundingBehaviour}>
          <SelectTrigger aria-label="Funding"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cycle_allowance">This cycle</SelectItem>
            <SelectItem value="accumulating">Accumulating</SelectItem>
            <SelectItem value="target_by_date">Target by date</SelectItem>
            <SelectItem value="reserve_target">Reserve</SelectItem>
          </SelectContent>
        </Select>
        <Input aria-label={copy.nextNeed} onChange={(event) => patch({ dueOn: event.target.value || null })} placeholder="Due date" value={line.dueOn ?? ""} />
        <Input aria-label="Target cents" onChange={(event) => patch({ targetCents: event.target.value || null })} value={line.targetCents ?? ""} />
        <Select onValueChange={(next) => { if (next === "carry" || next === "release_explicit") patch({ rolloverPolicy: next }) }} value={line.rolloverPolicy}>
          <SelectTrigger aria-label={copy.rollover}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="carry">Carry</SelectItem>
            <SelectItem value="release_explicit">Release only when asked</SelectItem>
          </SelectContent>
        </Select>
        <Select onValueChange={(next) => {
          const category = workspace?.categories.find((entry) => entry.id === next)
          patch({ categoryId: next || null, categoryNameSnapshot: category?.name ?? null, matchCategoryId: next || null })
        }} value={line.categoryId ?? undefined}>
          <SelectTrigger aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            {(workspace?.categories ?? []).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label={copy.expectedPayment} onChange={(event) => patch({ expectedPaymentOn: event.target.value || null })} placeholder="Expected payment date" value={line.expectedPaymentOn ?? ""} />
        <Select onValueChange={(next) => patch({ expectedPaymentAccountId: next || null })} value={line.expectedPaymentAccountId ?? undefined}>
          <SelectTrigger aria-label="Payment account"><SelectValue placeholder="Payment account" /></SelectTrigger>
          <SelectContent>
            {(workspace?.accounts ?? []).map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </details>
  )
}
