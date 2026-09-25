"use client"

import { useMemo, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { RangeControl } from "@/components/patterns/range-control"
import { DataGate } from "@/components/patterns/data-gate"
import { Section } from "@/components/patterns/section"
import { EnergyChart } from "@/domain/consumption/energy-chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getEnergyData, type EnergyData } from "@/features/energy/queries"
import { shortDate } from "@/lib/format/date"
import { formatNumber } from "@/lib/format/money"
import {
  buildEnergySeries,
  isWithinRange,
  toKwh,
  type RangeDays,
} from "@/domain/consumption/model"

function EnergyBody({ data, days }: { data: EnergyData; days: RangeDays }) {
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
                        {(reading.device_id ? deviceNames.get(reading.device_id) : null) ??
                          reading.source}
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
      <DataGate load={getEnergyData}>{(data) => <EnergyBody data={data} days={days} />}</DataGate>
    </div>
  )
}
