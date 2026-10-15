"use client"

import { Gauge } from "lucide-react"
import { useMemo, useState } from "react"
import { RangeControl } from "@/components/patterns/range-control"
import { useResource } from "@/hooks/use-resource"
import { ResourceFeedback } from "@/components/patterns/resource-feedback"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/patterns/section"
import { MoneyChart } from "@/domain/consumption/money-chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getWalletData, type WalletData } from "@/features/utilities/wallet-queries"
import { shortDate } from "@/lib/format/date"
import { formatMoney, sum } from "@/lib/format/money"
import { buildMoneySeries, isWithinRange, type RangeDays } from "@/domain/consumption/model"

export function WalletBody({ data, days, onRetry, refreshing = false }: { data: WalletData; days: RangeDays; onRetry: () => Promise<void>; refreshing?: boolean }) {
  const moneySeries = useMemo(
    () => buildMoneySeries(data.ledgerEntries, days),
    [data.ledgerEntries, days],
  )
  const deviceNames = new Map(data.devices.map((device) => [device.id, device.name]))
  const entries = [...data.ledgerEntries]
    .filter((entry) => isWithinRange(entry.occurred_at ?? entry.posted_at, days))
    .sort((first, second) =>
      (second.occurred_at ?? "").localeCompare(first.occurred_at ?? ""),
    )
    .slice(0, 24)
  const debitTotal = sum(
    entries.filter((entry) => entry.direction === "debit").map((entry) => entry.amount),
  )
  const latestSnapshot = [...data.financialSnapshots].sort((first, second) =>
    second.date.localeCompare(first.date),
  )[0]

  return (
    <div className="space-y-6">
      {data.financialError ? (
        <Alert>
          <AlertTitle>Some financial information is unavailable</AlertTitle>
          <AlertDescription>
            Utility wallet data is available. Some transaction or balance information could not be loaded.
            <Button className="mt-2" disabled={refreshing} onClick={() => void onRetry()} size="sm" variant="outline">Retry financial information</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Section
        description={`${formatMoney(debitTotal)} in utility ledger debits for this window. Debits and credits stay distinct.`}
        title="Wallet ledger"
      >
        <MoneyChart series={moneySeries} />
      </Section>
      <Section
        description="Charges, fees, deposits, and water invoices remain source facts."
        title="Ledger entries"
      >
          {entries.length === 0 ? (
            <p className="type-body text-muted-foreground">No ledger entries in this range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{shortDate(entry.occurred_at ?? entry.posted_at)}</TableCell>
                    <TableCell className="capitalize">
                      {entry.entry_type.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>
                      {deviceNames.get(entry.device_id) ?? entry.utility_type}
                    </TableCell>
                    <TableCell className="type-numeric text-right">
                      <span className="sr-only">
                        {entry.direction === "credit" ? "Money in" : "Money out"}
                      </span>
                      {entry.direction === "credit" ? "+" : "−"}
                      {formatMoney(entry.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Section>
      <Section
        description={
          data.financialTransactionCount === null ? "Transaction counts are unavailable." : data.financialTransactionCount > 0
            ? `${data.financialTransactionCount} imported transaction records are available to connect to this view.`
            : "No transaction records in this window."
        }
        title="Transactional finance"
      >
        {data.financialSnapshotUnavailable ? <p className="type-body-small text-muted-foreground">Tracked balances are unavailable.</p> : null}
        {latestSnapshot ? (
          <p className="flex items-center gap-2 text-sm">
            <Gauge className="size-4 text-muted-foreground" />
            <span>
              Latest tracked balance{" "}
              <strong className="type-numeric">
                {formatMoney(latestSnapshot.amount_cents / 100)}
              </strong>
            </span>
          </p>
        ) : null}
      </Section>
    </div>
  )
}

export function WalletView() {
  const [days, setDays] = useState<RangeDays>(90)
  const resource = useResource({ key: "utilities:wallet", load: getWalletData, retainData: true })

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="type-section-title text-foreground">Utility wallet</h2>
          <p className="type-body max-w-2xl text-muted-foreground">
            Explore wallet charges and the ledger behind utility usage.
          </p>
        </div>
        <RangeControl onChange={setDays} value={days} />
      </header>
      <ResourceFeedback resource={resource} title="Wallet information could not be loaded" />
      {resource.hasData ? <WalletBody data={resource.data!} days={days} onRetry={resource.reload} refreshing={resource.status === "refreshing"} /> : null}
    </div>
  )
}
