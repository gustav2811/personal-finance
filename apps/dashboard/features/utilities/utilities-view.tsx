"use client"

import { useState } from "react"
import { DataGate } from "@/components/patterns/data-gate"
import { HistoryControl } from "@/components/patterns/history-control"
import { PageHeader } from "@/components/patterns/page-header"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { HistoryWindow } from "@/lib/range"
import { EnergyPanel } from "@/features/utilities/energy-panel"
import { getEnergyData } from "@/features/utilities/queries"
import { WaterPanel } from "@/features/utilities/water-panel"

type Utility = "electricity" | "water"

export function UtilitiesView() {
  const [window, setWindow] = useState<HistoryWindow>(6)
  const [utility, setUtility] = useState<Utility>("electricity")

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<HistoryControl onChange={setWindow} value={window} />}
        title="Utilities"
      />
      <ToggleGroup
        aria-label="Utility"
        onValueChange={(next) => {
          if (next === "electricity" || next === "water") setUtility(next)
        }}
        size="sm"
        spacing={0}
        type="single"
        value={utility}
        variant="outline"
      >
        <ToggleGroupItem value="electricity">Electricity</ToggleGroupItem>
        <ToggleGroupItem value="water">Water</ToggleGroupItem>
      </ToggleGroup>
      <DataGate load={getEnergyData}>
        {(data) =>
          utility === "electricity" ? (
            <EnergyPanel data={data} window={window} />
          ) : (
            <WaterPanel data={data} window={window} />
          )
        }
      </DataGate>
    </div>
  )
}
