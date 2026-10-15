"use client"

import { useCallback, useRef, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { ResourceFeedback } from "./read-feedback"
import { Section } from "@/components/patterns/section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  buildConfigureAccountPayload,
  buildCorrectMovementPayload,
  buildCreateFundPayload,
  buildEarmarkPayload,
  buildReconciliationPayload,
  buildUpdateFundPayload,
  newCommandId,
  type CoverageAccountInput,
} from "@/domain/budget/commands"
import { commandFailureIsUncertain, commandFailureText, holdCommand, type HeldCommand } from "@/domain/budget/command-attempt"
import { copy } from "@/domain/budget/copy"
import {
  explainOpening,
  readCutover,
  readOpeningReasons,
  type CutoverAccount,
  type CutoverWorkspace,
  type OpeningExplanation,
} from "@/domain/budget/cutover"
import { readRecord, readString } from "@/domain/budget/wire"
import { memberName } from "@/domain/budget/members"
import { randsToCents } from "@/domain/budget/move"
import { formatCents } from "@/domain/budget/money"
import { useResource } from "@/hooks/use-resource"
import { readCutover as loadCutover, readDevices, writeBudgetRpc } from "./rpc"

function message(caught: unknown): string {
  return caught instanceof Error && caught.message.length > 0 ? caught.message : copy.couldNotSave
}

export type CutoverResourceData = { workspace: CutoverWorkspace; devices: Array<{ id: string; name: string }> }

async function defaultCutoverResource(_signal: AbortSignal): Promise<CutoverResourceData> {
    const [payload, devicePayload] = await Promise.all([loadCutover(), readDevices().catch(() => null)])
    const record = devicePayload && typeof devicePayload === "object" ? (devicePayload as { devices?: Array<{ id?: string; name?: string }> }) : null
    return {
      workspace: readCutover(payload),
      devices: (record?.devices ?? []).flatMap((device) => device.id && device.name ? [{ id: device.id, name: device.name }] : []),
    }
}

export function CutoverView({ loadResource = defaultCutoverResource, write = writeBudgetRpc }: {
  loadResource?: (signal: AbortSignal) => Promise<CutoverResourceData>
  write?: typeof writeBudgetRpc
}) {
  const load = useCallback((signal: AbortSignal) => loadResource(signal), [loadResource])
  const resource = useResource({ key: "budget-cutover", load, retainData: true })
  const workspace = resource.hasData ? resource.data!.workspace : null
  const devices = resource.hasData ? resource.data!.devices : []
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heldRef = useRef<HeldCommand | null>(null)
  const [outstanding, setOutstanding] = useState(false)
  const actionsReady = (resource.status === "ready" || outstanding)

  async function run(name: string, payload: Record<string, unknown>) {
    const heldNow = heldRef.current
    if (outstanding && heldNow && (heldNow.name !== name || JSON.stringify(heldNow.payload) !== JSON.stringify(payload))) {
      setActionError(copy.retryOutstandingMovement)
      return
    }
    const held = holdCommand(
      outstanding ? heldNow : null,
      { name, fingerprint: JSON.stringify({ name, payload }), payload },
      newCommandId,
    )
    heldRef.current = held
    setActionError(null)
    setNotice(null)
    try {
      const result = await write(held.name, held.id, held.payload)
      heldRef.current = null
      setOutstanding(false)
      setNotice(savedNotice(held.name, result, workspace?.accounts ?? []))
      void resource.reload()
    } catch (caught: unknown) {
      const uncertain = commandFailureIsUncertain(commandFailureText(caught))
      if (!uncertain) {
        heldRef.current = null
        setOutstanding(false)
      } else {
        setOutstanding(true)
      }
      setActionError(message(caught))
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        breadcrumbs={[{ href: "/budget", label: copy.pageTitle }, { label: copy.reconcile }]}
        description={copy.needsReconciliationDetail}
        title={copy.reconcile}
      />
      {outstanding ? (
        <Alert>
          <AlertTitle>{copy.retryOutstandingMovement}</AlertTitle>
          <AlertDescription>
            <Button onClick={() => { const held = heldRef.current; if (held) void run(held.name, held.payload) }} type="button">Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <ResourceFeedback loading="Reading the budget." resource={resource} saved={notice !== null} title="Budget reconciliation could not be loaded" />
      {actionError ? <Alert><AlertTitle>{copy.couldNotSave}</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {workspace ? <fieldset className="contents" disabled={!actionsReady}><CutoverBody devices={devices} onRun={run} workspace={workspace} /></fieldset> : null}
    </div>
  )
}

const EVIDENCE_GATES = [
  "Payroll net pay is reconciled. Deductions are not subtracted twice.",
  "Included ownership, currency, and sign convention are confirmed.",
  "Card debt is counted once.",
  "Notice, mortgage, and wallet reserves come from a statement, not the sheet.",
  "Say which utility charges count.",
] as const

function savedNotice(name: string, result: unknown, accounts: readonly CutoverAccount[]): string {
  if (name !== "budget_record_reconciliation_v1") return copy.saved
  const record = readRecord(result)
  const status = record ? readString(record, "status") : null
  if (!record || !status) return copy.saved
  return explainOpening({ status, reasons: readOpeningReasons(record.reasons), accounts }).notice
}

function OpeningStatus({ explanation }: { explanation: OpeningExplanation }) {
  return (
    <Alert>
      <AlertTitle>{explanation.headline}</AlertTitle>
      {explanation.findings.length > 0 ? (
        <AlertDescription>
          <ul className="space-y-2">
            {explanation.findings.map((finding) => (
              <li key={finding.accountId ?? "opening"}>
                <p>{finding.accountName}</p>
                <ul className="list-disc pl-4">
                  {finding.sentences.map((sentence) => (
                    <li key={sentence}>{sentence}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

function CutoverBody({
  devices,
  onRun,
  workspace,
}: {
  devices: Array<{ id: string; name: string }>
  onRun: (name: string, payload: Record<string, unknown>) => Promise<void>
  workspace: CutoverWorkspace
}) {
  const opening = workspace.reconciliation
    ? explainOpening({
        status: workspace.reconciliation.status,
        reasons: workspace.reconciliation.reasons,
        accounts: workspace.accounts,
      })
    : null
  return (
    <>
      {opening ? <OpeningStatus explanation={opening} /> : null}
      <Section title="Accounts">
        <ul className="space-y-6">
          {workspace.accounts.map((account) => (
            <li key={account.id}>
              <AccountForm
                account={account}
                devices={devices}
                findings={opening?.findings.find((finding) => finding.accountId === account.id)?.sentences ?? []}
                members={workspace.members}
                onRun={onRun}
              />
            </li>
          ))}
        </ul>
      </Section>
      <Section description="An incomplete record is saved. It does not create spendable cash." title={copy.reconcile}>
        <ReconciliationForm accounts={workspace.accounts} onRun={onRun} />
      </Section>
      <Section title={copy.purposes}>
        <FundForms onRun={onRun} workspace={workspace} />
      </Section>
      <Section description={copy.fundedNotAccessible} title={copy.restricted}>
        <EarmarkForm onRun={onRun} workspace={workspace} />
      </Section>
      <Section title="Correct a movement">
        <MovementForm onRun={onRun} workspace={workspace} />
      </Section>
    </>
  )
}

function AccountForm({
  account,
  devices,
  findings,
  members,
  onRun,
}: {
  account: CutoverAccount
  devices: Array<{ id: string; name: string }>
  findings: readonly string[]
  members: CutoverWorkspace["members"]
  onRun: (name: string, payload: Record<string, unknown>) => Promise<void>
}) {
  const settings = account.settings
  const [ownerScope, setOwnerScope] = useState<"shared" | "member">(settings?.ownerScope ?? "shared")
  const [ownerMemberId, setOwnerMemberId] = useState(settings?.ownerMemberId ?? "")
  const [included, setIncluded] = useState(settings?.included ?? true)
  const [exclusionReason, setExclusionReason] = useState(settings?.exclusionReason ?? "")
  const [resourceClass, setResourceClass] = useState(settings?.resourceClass ?? "liquid")
  const [sign, setSign] = useState(settings?.transactionSignConvention ?? "unknown")
  const [signEvidence, setSignEvidence] = useState(settings?.signEvidence ?? "")
  const [freshness, setFreshness] = useState(String(settings?.freshnessHours ?? 24))
  const [settlement, setSettlement] = useState(settings?.settlementAccountId ?? "")
  const [deviceId, setDeviceId] = useState(settings?.utilityDeviceId ?? "")

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const hours = Number(freshness)
        void onRun(
          "budget_configure_account_v1",
          buildConfigureAccountPayload({
            accountId: account.id,
            expectedSettingsFingerprint: settings?.settingsFingerprint,
            ownerScope,
            ownerMemberId: ownerScope === "member" ? ownerMemberId : undefined,
            included,
            exclusionReason: included ? undefined : exclusionReason,
            resourceClass,
            settlementAccountId: settlement || undefined,
            freshnessHours: hours,
            transactionSignConvention: sign,
            signEvidence: sign === "unknown" ? undefined : signEvidence,
            utilityDeviceId: deviceId || undefined,
          }),
        )
      }}
    >
      <p>{account.name}</p>
      <p className="type-caption text-muted-foreground">
        {settings ? copy.accountSetUp : copy.accountNotSetUp}
      </p>
      {findings.length > 0 ? (
        <ul className="list-disc pl-4 text-sm">
          {findings.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      ) : null}
      <Select onValueChange={(next) => { if (next === "shared" || next === "member") setOwnerScope(next) }} value={ownerScope}>
        <SelectTrigger aria-label={copy.beneficiary}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="shared">{copy.shared}</SelectItem>
          <SelectItem value="member">One person</SelectItem>
        </SelectContent>
      </Select>
      {ownerScope === "member" ? (
        <Select onValueChange={(next) => { if (next) setOwnerMemberId(next) }} value={ownerMemberId || undefined}>
          <SelectTrigger aria-label={copy.plannedPayer}><SelectValue /></SelectTrigger>
          <SelectContent>
            {members.map((member) => <SelectItem key={member.id} value={member.id}>{memberName(members, member.id)}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      <Select onValueChange={(next) => { if (next === "liquid" || next === "restricted" || next === "mortgage" || next === "card" || next === "tracking_only") setResourceClass(next) }} value={resourceClass}>
        <SelectTrigger aria-label="Where this money sits"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="liquid">Can pay a bill</SelectItem>
          <SelectItem value="restricted">Notice deposit</SelectItem>
          <SelectItem value="mortgage">Mortgage</SelectItem>
          <SelectItem value="card">Card</SelectItem>
          <SelectItem value="tracking_only">Track only</SelectItem>
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <input checked={included} onChange={(event) => setIncluded(event.target.checked)} type="checkbox" />
        Included
      </label>
      {included ? null : <Input aria-label="Exclusion reason" onChange={(event) => setExclusionReason(event.target.value)} value={exclusionReason} />}
      <Input aria-label="Freshness hours" onChange={(event) => setFreshness(event.target.value)} value={freshness} />
      <Input aria-label="Card settles into" onChange={(event) => setSettlement(event.target.value)} placeholder="Account that settles the card" value={settlement} />
      <Select onValueChange={(next) => { if (next === "outflow_negative" || next === "outflow_positive" || next === "unknown") setSign(next) }} value={sign}>
        <SelectTrigger aria-label="Sign"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="outflow_negative">Money out is negative</SelectItem>
          <SelectItem value="outflow_positive">Money out is positive</SelectItem>
          <SelectItem value="unknown">Unknown</SelectItem>
        </SelectContent>
      </Select>
      {sign === "unknown" ? null : <Input aria-label="Note" onChange={(event) => setSignEvidence(event.target.value)} value={signEvidence} />}
      <Select onValueChange={(next) => { if (next) setDeviceId(next) }} value={deviceId || undefined}>
        <SelectTrigger aria-label="Wallet device"><SelectValue placeholder="Wallet device" /></SelectTrigger>
        <SelectContent>
          {deviceId && !devices.some((device) => device.id === deviceId) ? (
            <SelectItem value={deviceId}>Saved wallet</SelectItem>
          ) : null}
          {devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit">Save account</Button>
    </form>
  )
}

function ReconciliationForm({
  accounts,
  onRun,
}: {
  accounts: CutoverAccount[]
  onRun: (name: string, payload: Record<string, unknown>) => Promise<void>
}) {
  const [notes, setNotes] = useState("")
  const [evidence, setEvidence] = useState("")
  const [utilityStatus, setUtilityStatus] = useState<"not_required" | "verified" | "unknown">("unknown")
  const [utilityEvidence, setUtilityEvidence] = useState("")
  const [cutoff, setCutoff] = useState("")
  const [gates, setGates] = useState<boolean[]>(EVIDENCE_GATES.map(() => false))
  const [rows, setRows] = useState<Record<string, { status: "included" | "excluded" | "missing"; convention: CoverageAccountInput["balanceConvention"]; evidence: string; activityThrough: string; restricted: string; restrictedEvidence: string; pending: string[] }>>({})

  function row(account: CutoverAccount) {
    return rows[account.id] ?? {
      status: account.settings?.included === false ? "excluded" : "included",
      convention: account.settings?.resourceClass === "card" ? "debt_positive" : "cash_signed",
      evidence: "",
      activityThrough: account.latestSnapshot?.observedAt ?? "",
      restricted: "",
      restrictedEvidence: "",
      pending: [],
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void onRun(
          "budget_record_reconciliation_v1",
          buildReconciliationPayload({
            asOf: new Date().toISOString(),
            openingFundCutover: cutoff && gates.every(Boolean) ? cutoff : undefined,
            notes,
            evidence,
            utilityStatus,
            utilityEvidence,
            accounts: accounts.map((account) => {
              const current = row(account)
              return {
                accountId: account.id,
                status: current.status,
                settingsFingerprint: account.settings?.settingsFingerprint,
                snapshotDate: account.latestSnapshot?.date,
                snapshotFingerprint: account.latestSnapshot?.snapshotFingerprint,
                balanceConvention: current.convention,
                activityThrough: current.activityThrough || undefined,
                pendingIncludedIds: current.pending,
                eligibleRestrictedCents: current.restricted || undefined,
                restrictedEvidence: current.restrictedEvidence || undefined,
                evidence: current.evidence,
              }
            }),
          }),
        )
      }}
    >
      <Textarea aria-label="Notes" onChange={(event) => setNotes(event.target.value)} value={notes} />
      <Textarea aria-label="Note" onChange={(event) => setEvidence(event.target.value)} value={evidence} />
      <Input aria-label="Opening date" onChange={(event) => setCutoff(event.target.value)} placeholder="2026-09-23" value={cutoff} />
      <ul className="space-y-1">
        {EVIDENCE_GATES.map((gate, index) => (
          <li key={gate}>
            <label className="flex items-start gap-2 text-sm">
              <input
                checked={gates[index] === true}
                onChange={(event) => setGates(gates.map((value, gateIndex) => gateIndex === index ? event.target.checked : value))}
                type="checkbox"
              />
              {gate}
            </label>
          </li>
        ))}
      </ul>
      {cutoff && !gates.every(Boolean) ? <p className="type-caption text-muted-foreground">The opening date stays unset until each of these is confirmed.</p> : null}
      <Select onValueChange={(next) => { if (next === "not_required" || next === "verified" || next === "unknown") setUtilityStatus(next) }} value={utilityStatus}>
        <SelectTrigger aria-label="Which utilities count"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="unknown">Utilities unknown</SelectItem>
          <SelectItem value="not_required">Utilities not required</SelectItem>
          <SelectItem value="verified">Utilities verified</SelectItem>
        </SelectContent>
      </Select>
      <Input aria-label="Note about utilities" onChange={(event) => setUtilityEvidence(event.target.value)} value={utilityEvidence} />
      {accounts.map((account) => {
        const current = row(account)
        return (
          <div className="space-y-2 rounded-lg border p-3" key={account.id}>
            <p>{account.name}</p>
            <p className="type-caption text-muted-foreground">
              {account.latestSnapshot ? `Balance on ${account.latestSnapshot.date}: ${formatCents(account.latestSnapshot.amountCents)}` : "No balance yet. This account cannot be included until there is one."}
            </p>
            <Input aria-label={`${account.name} note`} onChange={(event) => setRows({ ...rows, [account.id]: { ...current, evidence: event.target.value } })} value={current.evidence} />
            <Input aria-label={`${account.name} activity`} onChange={(event) => setRows({ ...rows, [account.id]: { ...current, activityThrough: event.target.value } })} placeholder="Activity through" value={current.activityThrough} />
            {account.pendingIds.length > 0 ? (
              <ul className="space-y-1">
                {account.pendingIds.map((pendingId) => (
                  <li key={pendingId}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={current.pending.includes(pendingId)}
                        onChange={(event) => {
                          const pending = event.target.checked
                            ? [...current.pending, pendingId]
                            : current.pending.filter((id) => id !== pendingId)
                          setRows({ ...rows, [account.id]: { ...current, pending } })
                        }}
                        type="checkbox"
                      />
                      A pending movement is already in this balance
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {(account.settings?.resourceClass === "restricted" || account.settings?.resourceClass === "mortgage") ? (
              <>
                <Input aria-label="Amount that cannot pay a bill today" onChange={(event) => setRows({ ...rows, [account.id]: { ...current, restricted: event.target.value } })} placeholder="Cents that cannot pay a bill today" value={current.restricted} />
                <Input aria-label="Note" onChange={(event) => setRows({ ...rows, [account.id]: { ...current, restrictedEvidence: event.target.value } })} value={current.restrictedEvidence} />
              </>
            ) : null}
          </div>
        )
      })}
      <Button type="submit">{copy.agreeOpening}</Button>
    </form>
  )
}

function FundForms({ onRun, workspace }: { onRun: (name: string, payload: Record<string, unknown>) => Promise<void>; workspace: CutoverWorkspace }) {
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"shared" | "member">("shared")
  const [memberId, setMemberId] = useState("")
  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void onRun("budget_create_fund_v1", buildCreateFundPayload({
            name,
            beneficiaryScope: scope,
            beneficiaryMemberId: scope === "member" ? memberId : undefined,
          }))
        }}
      >
        <Input aria-label="Purpose name" onChange={(event) => setName(event.target.value)} value={name} />
        <Select onValueChange={(next) => { if (next === "shared" || next === "member") setScope(next) }} value={scope}>
          <SelectTrigger aria-label={copy.beneficiary}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="shared">{copy.shared}</SelectItem>
            <SelectItem value="member">One person</SelectItem>
          </SelectContent>
        </Select>
        {scope === "member" ? (
          <Select onValueChange={(next) => { if (next) setMemberId(next) }} value={memberId || undefined}>
            <SelectTrigger aria-label={copy.beneficiary}><SelectValue /></SelectTrigger>
            <SelectContent>
              {workspace.members.map((member) => <SelectItem key={member.id} value={member.id}>{memberName(workspace.members, member.id)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        <Button type="submit">Add purpose</Button>
      </form>
      <ul className="space-y-2">
        {workspace.funds.map((fund) => (
          <li className="flex items-center justify-between gap-3" key={fund.id}>
            <span>{fund.name}</span>
            <Button
              onClick={() => void onRun("budget_update_fund_v1", buildUpdateFundPayload({
                fundId: fund.id,
                expectedName: fund.name,
                expectedStatus: fund.status,
                name: fund.name,
                status: fund.status === "active" ? "retired" : "active",
              }))}
              type="button"
              variant="outline"
            >
              {fund.status === "active" ? "Retire" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EarmarkForm({ onRun, workspace }: { onRun: (name: string, payload: Record<string, unknown>) => Promise<void>; workspace: CutoverWorkspace }) {
  const [fundId, setFundId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [reason, setReason] = useState("")
  const reconciliation = workspace.reconciliation
  const restricted = workspace.accounts.filter((account) => account.settings?.resourceClass === "restricted" || account.settings?.resourceClass === "mortgage")
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        const cents = randsToCents(amount)
        if (!cents || !reconciliation?.fingerprint) return
        void onRun("budget_change_earmark_v1", buildEarmarkPayload({
          fundId,
          restrictedAccountId: accountId,
          amountCents: cents,
          effectiveOn: date,
          reason,
          expectedReconciliationId: reconciliation.id,
          expectedReconciliationFingerprint: reconciliation.fingerprint,
          link: { reconciliationId: reconciliation.id },
        }))
      }}
    >
      {reconciliation?.fingerprint ? null : <p className="type-caption text-muted-foreground">{copy.needsReconciliation}</p>}
      <Select onValueChange={(next) => { if (next) setFundId(next) }} value={fundId || undefined}>
        <SelectTrigger aria-label={copy.purposes}><SelectValue /></SelectTrigger>
        <SelectContent>{workspace.funds.map((fund) => <SelectItem key={fund.id} value={fund.id}>{fund.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select onValueChange={(next) => { if (next) setAccountId(next) }} value={accountId || undefined}>
        <SelectTrigger aria-label={copy.restricted}><SelectValue /></SelectTrigger>
        <SelectContent>{restricted.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
      </Select>
      <Input aria-label="Amount" onChange={(event) => setAmount(event.target.value)} value={amount} />
      <Input aria-label="Effective on" onChange={(event) => setDate(event.target.value)} placeholder="2026-09-23" value={date} />
      <Input aria-label="Reason" onChange={(event) => setReason(event.target.value)} value={reason} />
      <Button disabled={!reconciliation?.fingerprint} type="submit">Reserve this amount</Button>
      <ul className="space-y-1">
        {workspace.earmarks.map((earmark) => (
          <li className="type-caption" key={earmark.id}>{earmark.amountCents} · {earmark.effectiveOn} · {earmark.reason}</li>
        ))}
      </ul>
    </form>
  )
}

function MovementForm({ onRun, workspace }: { onRun: (name: string, payload: Record<string, unknown>) => Promise<void>; workspace: CutoverWorkspace }) {
  const [movementId, setMovementId] = useState("")
  const [reason, setReason] = useState("")
  const reconciliation = workspace.reconciliation
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!reconciliation?.fingerprint) return
        void onRun("budget_correct_movement_v1", buildCorrectMovementPayload({
          movementId,
          expectedReconciliationId: reconciliation.id,
          expectedReconciliationFingerprint: reconciliation.fingerprint,
          reason,
        }))
      }}
    >
      <Select onValueChange={(next) => { if (next) setMovementId(next) }} value={movementId || undefined}>
        <SelectTrigger aria-label="Earlier movement"><SelectValue placeholder="Earlier movement" /></SelectTrigger>
        <SelectContent>
          {workspace.movements.map((movement) => (
            <SelectItem key={movement.id} value={movement.id}>{movement.kind} · {movement.amountCents} · {movement.effectiveOn}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input aria-label="Reason" onChange={(event) => setReason(event.target.value)} value={reason} />
      <Button disabled={!reconciliation?.fingerprint} type="submit">Reverse movement</Button>
    </form>
  )
}
