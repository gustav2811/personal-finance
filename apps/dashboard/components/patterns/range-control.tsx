"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { RANGE_ITEMS, type RangeDays } from "@/lib/consumption"

export function RangeControl({
  onChange,
  value,
}: {
  onChange: (days: RangeDays) => void
  value: RangeDays
}) {
  return (
    <ToggleGroup
      aria-label="Time range"
      onValueChange={(next) => {
        if (next === "30" || next === "90" || next === "365") {
          onChange(Number(next) as RangeDays)
        }
      }}
      size="sm"
      spacing={0}
      type="single"
      value={String(value)}
      variant="outline"
    >
      {RANGE_ITEMS.map((item) => (
        <ToggleGroupItem key={item.days} value={String(item.days)}>
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
