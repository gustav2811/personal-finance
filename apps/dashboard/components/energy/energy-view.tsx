"use client"

import { useMemo, useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { RangeControl } from "@/components/app/range-control"
import { DataGate } from "@/components/household/data-gate"
import { Section } from "@/components/app/section"
import { EnergyChart } from "@/components/household/charts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatNumber, shortDate } from "@/lib/format"
import {
  buildEnergySeries,
  isWithinRange,
  toKwh,
  type RangeDays,
} from "@/lib/household"
import type { DashboardData } from "@/lib/data"

function EnergyBody({ data, days }: { data: DashboardData; days: RangeDays }) {
  const series = useMemo(
    () => buildEnergySeries(data.readings, days),
    [data.readings, days],
  )
  const deviceNames = new Map(data.devices.map((device) => [device.id, device.name]))
  const recentReadings = [...data.readings]
    .filter((reading) => isWithinRange(reading.period_start, days))
    .sort((first, second) => second.period_start.localeCompare(first.period_start))
    .slice(0, 18)

  return (
    <div className="space-y-6">
      <Section
        description={`${series.length} plotted days. Traces keep the source resolution.`}
        title="Daily energy"
      >
        <EnergyChart series={series} />
      </Section>
      <Section
        description="ISMRT energy stays in native Wh at rest and is shown in kWh."
        title="Recent readings"
      >
          {recentReadings.length === 0 ? (
            <p className="type-body text-muted-foreground">No readings in this range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Reading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentReadings.map((reading) => {
                  const value = toKwh(reading)
                  return (
                    <TableRow key={reading.id}>
                      <TableCell>{shortDate(reading.period_start)}</TableCell>
                      <TableCell>{reading.measurement_target}</TableCell>
                      <TableCell>
                        {deviceNames.get(reading.device_id) ?? reading.source}
                      </TableCell>
                      <TableCell className="type-numeric text-right">
                        {value === null
                          ? `${formatNumber(reading.value)} ${reading.unit}`
                          : `${formatNumber(value)} kWh`}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </Section>
    </div>
  )
}

export function EnergyView() {
  const [days, setDays] = useState<RangeDays>(90)

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<RangeControl onChange={setDays} value={days} />}
        description="Whole-home demand alongside the devices that make the pattern personal."
        title="Energy"
      />
      <DataGate scope="energy">{(data) => <EnergyBody data={data} days={days} />}</DataGate>
    </div>
  )
}
