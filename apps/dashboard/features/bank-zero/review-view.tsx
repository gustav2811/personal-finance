"use client"

import { useCallback, useEffect, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { Section } from "@/components/patterns/section"
import { listBankZeroReview, reviewBankZeroObservation, type BankZeroReviewItem } from "./rpc"

function displayValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return "—"
  return String(value)
}

function amountLabel(values: Record<string, unknown>): string {
  const cents = Number(values.amountMinor)
  if (!Number.isFinite(cents)) return "Amount unavailable"
  const amount = values.direction === "debit" ? -cents / 100 : cents / 100
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: displayValue(values.currency || "ZAR") }).format(amount)
}

export function BankZeroReviewView() {
  const [items, setItems] = useState<BankZeroReviewItem[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setItems(await listBankZeroReview())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Bank Zero review work")
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const hasActiveReplay = items.some((item) => item.replay_status === "pending" || item.replay_status === "in_progress")
    if (!hasActiveReplay) return
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [items, refresh])

  async function act(item: BankZeroReviewItem, action: "associate" | "dismiss" | "replay") {
    const movementId = selected[item.observation_id] ?? item.candidate_movements[0]?.movement_id
    if (action === "associate" && !movementId) {
      setError("There is no suggested movement to associate. Dismiss this item or wait for more evidence.")
      return
    }
    setBusyId(item.observation_id)
    setError(null)
    try {
      await reviewBankZeroObservation(item.observation_id, action, action === "associate" ? movementId : undefined)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the review decision")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Zero review"
        description="Resolve uncertain message matches, inspect the evidence, and re-run retained email through the current parser."
      />
      {error ? <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p> : null}
      {!loaded ? <p className="type-body text-muted-foreground">Loading unresolved work…</p> : null}
      {loaded && items.length === 0 ? (
        <Section title="All caught up" description="There are no deferred or uncertain Bank Zero observations to review." />
      ) : null}
      {items.map((item) => {
        const parsed = item.parsed_values ?? {}
        const raw = item.raw_values ?? {}
        const candidates = item.candidate_movements ?? []
        const current = selected[item.observation_id] ?? candidates[0]?.movement_id ?? ""
        return (
          <Section key={item.observation_id} title={`${amountLabel(parsed)} · ${displayValue(parsed.counterparty ?? parsed.accountAlias ?? item.kind)}`} description={item.reason ?? `Received ${new Date(item.received_at).toLocaleString()}`}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p><strong>Route:</strong> {item.route_key}</p>
                <p><strong>Evidence type:</strong> {item.kind}</p>
                <p><strong>Subject:</strong> {displayValue(raw.subject)}</p>
                <p><strong>Source:</strong> {item.source_expired_at ? "Expired" : "Available for replay"}</p>
                {item.replay_status ? <p><strong>Latest re-evaluation:</strong> {item.replay_error ?? item.replay_status}</p> : null}
                <p className="whitespace-pre-wrap text-muted-foreground">{displayValue(raw.bodySnippet)}</p>
                <p><strong>Reference:</strong> {displayValue(parsed.reference)}</p>
                <p><strong>Event:</strong> {displayValue(parsed.eventAt ?? parsed.postedOn)}</p>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">Suggested movements</p>
                {candidates.length === 0 ? <p className="text-sm text-muted-foreground">No unique candidate was suggested.</p> : (
                  <select className="w-full rounded-lg border bg-background px-3 py-2 text-sm" value={current} onChange={(event) => setSelected((state) => ({ ...state, [item.observation_id]: event.target.value }))} aria-label="Movement to associate">
                    {candidates.map((candidate) => (
                      <option key={candidate.movement_id} value={candidate.movement_id}>
                        {candidate.description} · {new Intl.NumberFormat("en-ZA", { style: "currency", currency: candidate.currency_code }).format(candidate.amount)} · {candidate.posted_on ?? candidate.occurred_at ?? "date unknown"} · {candidate.publication_state}
                      </option>
                    ))}
                  </select>
                )}
                {candidates.map((candidate) => (
                  <p key={candidate.movement_id} className="text-xs text-muted-foreground">
                    {candidate.reconciliation_state} · publication {candidate.publication_state}
                    {candidate.finwise_transaction_id ? ` · FinWise ${candidate.finwise_transaction_id}` : ""}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2 pt-2">
                  <button className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busyId === item.observation_id || candidates.length === 0} onClick={() => void act(item, "associate")}>Associate</button>
                  <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={busyId === item.observation_id || Boolean(item.source_expired_at)} onClick={() => void act(item, "replay")}>Re-evaluate</button>
                  <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={busyId === item.observation_id} onClick={() => void act(item, "dismiss")}>Dismiss</button>
                </div>
              </div>
            </div>
          </Section>
        )
      })}
    </div>
  )
}
