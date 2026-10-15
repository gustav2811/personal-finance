import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/** Use ChartTooltipContent first. This surface is for custom, domain-specific readouts. */
export function ChartTooltipSurface({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("type-numeric rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl", className)}
      {...props}
    />
  )
}
