"use client"

import { DataGate } from "@/components/household/data-gate"
import { PageHeader } from "@/components/app/page-header"
import { Section } from "@/components/app/section"
import { SourceList } from "@/components/sources/source-list"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatNumber } from "@/lib/format"
import type { DashboardData } from "@/lib/data"

function SourcesBody({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <Section
        description="Physical and logical signals feeding the household record."
        title="Connected sources"
      >
        <SourceList devices={data.devices} readings={data.readings} />
      </Section>
      <Section
        description="Each runner writes its own audit row. This view reads that status and does not write to the pipeline. Raw events and source identifiers stay in Supabase."
        title="Ingestion"
      >
          {data.ingestionRuns.length === 0 ? (
            <p className="type-body text-muted-foreground">No ingestion runs recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Runner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ingestionRuns.slice(0, 15).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.source}</TableCell>
                    <TableCell className="font-mono text-xs">{run.runner}</TableCell>
                    <TableCell
                      className={run.status === "failed" ? "text-destructive" : undefined}
                    >
                      {run.status}
                    </TableCell>
                    <TableCell className="type-numeric text-right">
                      {formatNumber(run.rows_written, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Section>
    </div>
  )
}

export function SourcesView() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Meters, plugs, and ingestion runs that feed the household record."
        title="Sources"
      />
      <DataGate scope="sources">{(data) => <SourcesBody data={data} />}</DataGate>
    </div>
  )
}
