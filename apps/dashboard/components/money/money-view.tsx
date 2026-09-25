"use client"

import { Gauge } from "lucide-react"
import { useMemo, useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { RangeControl } from "@/components/app/range-control"
import { DataGate } from "@/components/household/data-gate"
import { Section } from "@/components/app/section"
import { MoneyChart } from "@/components/household/charts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatMoney, shortDate, sum } from "@/lib/format"
import { buildMoneySeries, isWithinRange, type RangeDays } from "@/lib/household"
import type { DashboardData } from "@/lib/data"

function MoneyBody({ data, days }: { data: DashboardData; days: RangeDays }) {
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
          <AlertTitle>Financial tables need a read policy</AlertTitle>
          <AlertDescription>
            Utility wallet data is available. Existing transaction and snapshot tables are
            not exposed to this authenticated role yet.
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
          data.financialTransactionCount > 0
            ? `${data.financialTransactionCount} imported transaction records are available to connect to this view.`
            : "No transactional records are visible to this role yet."
        }
        title="Transactional finance"
      >
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

export function MoneyView() {
  const [days, setDays] = useState<RangeDays>(90)

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<RangeControl onChange={setDays} value={days} />}
        description="Wallet movement, utility charges, and the financial record behind the usage."
        title="Money"
      />
      <DataGate scope="money">{(data) => <MoneyBody data={data} days={days} />}</DataGate>
    </div>
  )
}
