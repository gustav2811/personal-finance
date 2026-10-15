"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DataGate } from "@/components/patterns/data-gate"
import { HistoryControl } from "@/components/patterns/history-control"
import { PageHeader } from "@/components/patterns/page-header"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { HistoryWindow } from "@/lib/range"
import { EnergyPanel } from "@/features/utilities/energy-panel"
import { getEnergyData } from "@/features/utilities/queries"
import { WaterPanel } from "@/features/utilities/water-panel"
import { WalletView } from "@/features/utilities/wallet-view"

type UtilityTab = "electricity" | "water" | "wallet"

export function UtilitiesView({
  initialTab = "electricity",
  initialRange,
}: {
  initialTab?: UtilityTab
  initialRange?: { from: string; to: string }
}) {
  const router = useRouter()
  const [window, setWindow] = useState<HistoryWindow>(6)
  const [tab, setTab] = useState<UtilityTab>(initialTab)

  useEffect(() => setTab(initialTab), [initialTab])

  return (
    <div className="@container/utilities space-y-6">
      <PageHeader title="Utilities" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label="Utilities view"
          onValueChange={(next) => {
            if (
              next === "electricity" ||
              next === "water" ||
              next === "wallet"
            ) {
              setTab(next)
              const query = new URLSearchParams()
              if (next !== "electricity") query.set("tab", next)
              if (initialRange) {
                query.set("from", initialRange.from)
                query.set("to", initialRange.to)
              }
              const suffix = query.toString()
              router.push(`/utilities${suffix ? `?${suffix}` : ""}`, {
                scroll: false,
              })
            }
          }}
          size="sm"
          spacing={0}
          type="single"
          value={tab}
          variant="outline"
        >
          <ToggleGroupItem
            className="pointer-coarse:h-9 pointer-coarse:px-3"
            value="electricity"
          >
            Electricity
          </ToggleGroupItem>
          <ToggleGroupItem
            className="pointer-coarse:h-9 pointer-coarse:px-3"
            value="water"
          >
            Water
          </ToggleGroupItem>
          <ToggleGroupItem
            className="pointer-coarse:h-9 pointer-coarse:px-3"
            value="wallet"
          >
            Wallet
          </ToggleGroupItem>
        </ToggleGroup>
        {tab === "wallet" ? null : (
          <HistoryControl onChange={setWindow} value={window} />
        )}
      </div>
      {tab === "wallet" ? (
        <WalletView />
      ) : (
        <DataGate load={getEnergyData}>
          {(data) =>
            tab === "electricity" ? (
              <EnergyPanel data={data} window={window} period={initialRange} />
            ) : (
              <WaterPanel data={data} window={window} />
            )
          }
        </DataGate>
      )}
    </div>
  )
}
