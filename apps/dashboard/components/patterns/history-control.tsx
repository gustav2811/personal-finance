"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { HistoryWindow } from "@/lib/range"

const ITEMS: Array<{ label: string; value: HistoryWindow }> = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "Years", value: "all" },
]

export function HistoryControl({
  onChange,
  value,
}: {
  onChange: (window: HistoryWindow) => void
  value: HistoryWindow
}) {
  return (
    <ToggleGroup
      aria-label="History window"
      onValueChange={(next) => {
        const match = ITEMS.find((item) => String(item.value) === next)
        if (match) onChange(match.value)
      }}
      size="sm"
      spacing={0}
      type="single"
      value={String(value)}
      variant="outline"
    >
      {ITEMS.map((item) => (
        <ToggleGroupItem key={String(item.value)} value={String(item.value)}>
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
