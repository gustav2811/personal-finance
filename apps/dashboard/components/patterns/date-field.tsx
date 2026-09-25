"use client"

import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { parseIsoDate, toIsoDate } from "@/lib/format/date"

export function DateField({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const selected = parseIsoDate(value)

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            className="w-[9.5rem] justify-start font-normal"
            id={id}
            size="sm"
            variant="outline"
          >
            <CalendarIcon />
            {selected
              ? selected.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
              : "Any"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            onSelect={(date) => onChange(date ? toIsoDate(date) : "")}
            selected={selected}
          />
          {value ? (
            <div className="border-t p-2">
              <Button
                className="w-full"
                onClick={() => onChange("")}
                size="sm"
                variant="ghost"
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
