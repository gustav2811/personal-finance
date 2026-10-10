"use client"

import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildDraftPayload, buildPublishPayload, newCommandId } from "@/domain/budget/commands"
import { copy } from "@/domain/budget/copy"
import { addMonths, cycleLabel } from "@/domain/budget/cycle"
import { isCents } from "@/domain/budget/money"
import {
  chosenStartsOn,
  cloneLines,
  latestPublished,
  planDiff,
  publishReady,
  readDraftReceipt,
  readPublishedPlan,
  readVersionPage,
  replaceContribution,
  toDraftLines,
  type CycleChoice,
  type DraftReceipt,
  type PlanLine,
  type PublishedPlan,
  type VersionHeader,
} from "@/domain/budget/plan"
import { readVersion, readVersions, writeBudgetRpc } from "./rpc"

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
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoadError(null)
    void loadPublishedPlan()
      .then((next) => {
        if (cancelled) return
        setPublished(next)
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

  async function onPublish() {
    if (!published || !publishReady(reason, lines) || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    setPublishFailed(false)
    const startsOnCycle = chosenStartsOn(published.startsOnCycle, choice)
    try {
      const saved = readDraftReceipt(
        await writeBudgetRpc(
          "budget_save_draft_v1",
          newCommandId(),
          buildDraftPayload({
            draftId: draft?.versionId,
            expectedDraftRevision: draft?.draftRevision,
            parentVersionId: published.versionId,
            startsOnCycle,
            reason,
            lines: toDraftLines(lines),
          }),
        ),
      )
      setDraft(saved)
      try {
        // A new version does not move money between purposes.
        await writeBudgetRpc(
          "budget_publish_v1",
          newCommandId(),
          buildPublishPayload({
            draftId: saved.versionId,
            expectedDraftRevision: saved.draftRevision,
            expectedParentVersionId: published.versionId,
            expectedLatestVersionNumber: published.versionNumber,
            reason,
          }),
        )
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
        </Alert>
      ) : null}
      {published ? (
        <PlanBody
          choice={choice}
          lines={lines}
          pending={pending}
          published={published}
          reason={reason}
          onChoice={setChoice}
          onLines={setLines}
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
  onChoice,
  onLines,
  onPublish,
  onReason,
  pending,
  published,
  reason,
}: {
  choice: CycleChoice
  lines: PlanLine[]
  onChoice: (choice: CycleChoice) => void
  onLines: (lines: PlanLine[]) => void
  onPublish: () => void
  onReason: (reason: string) => void
  pending: boolean
  published: PublishedPlan
  reason: string
}) {
  const startsOn = chosenStartsOn(published.startsOnCycle, choice)
  const diff = planDiff(published.lines, lines)
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
        <ul className="divide-y rounded-lg border">
          {lines.map((line) => {
            const invalid = !isCents(line.contributionCents) || line.contributionCents.startsWith("-")
            return (
              <li className="space-y-2 px-4 py-3" key={line.stableLineId}>
                <label className="block space-y-2" htmlFor={`plan-line-${line.stableLineId}`}>
                  <span className="block">{line.name}</span>
                  <Input
                    aria-invalid={invalid}
                    autoComplete="off"
                    className="type-numeric"
                    id={`plan-line-${line.stableLineId}`}
                    inputMode="numeric"
                    onChange={(event) => onLines(replaceContribution(lines, line.stableLineId, event.target.value))}
                    value={line.contributionCents}
                  />
                </label>
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
