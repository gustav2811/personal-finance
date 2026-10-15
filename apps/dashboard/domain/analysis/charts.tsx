"use client"

import { useId } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export const ANALYSIS_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]
export type ChartPart = { key: string; name: string; value: number }
export function AnalysisRing({
  parts,
  label = "Selected total",
  total,
  format,
  onSelect,
}: {
  parts: ChartPart[]
  label?: string
  total: number
  format: (n: number) => string
  onSelect: (key: string) => void
}) {
  return (
    <div className="relative mx-auto w-full max-w-lg">
      <ChartContainer
        config={{ value: { label: "Amount", color: "var(--chart-1)" } }}
        className="aspect-square w-full"
      >
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  String(payload?.[0]?.payload?.name ?? "")
                }
                formatter={(v) => format(Number(v))}
              />
            }
          />
          <Pie
            isAnimationActive={false}
            data={parts}
            dataKey="value"
            nameKey="name"
            innerRadius="67%"
            outerRadius="92%"
            paddingAngle={2}
            cornerRadius={6}
            stroke="var(--background)"
            strokeWidth={2}
            onClick={(entry) => onSelect(String(entry.key))}
            className="cursor-pointer"
          >
            {parts.map((p, i) => (
              <Cell
                key={p.key}
                fill={ANALYSIS_COLORS[i % 5]}
                role="button"
                tabIndex={0}
                aria-label={`${p.name}: ${format(p.value)}, show transactions`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect(p.key)
                  }
                }}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <span className="type-caption">{label}</span>
        <strong className="type-display type-numeric">{format(total)}</strong>
      </div>
    </div>
  )
}

export function AnalysisBars({
  points,
  format,
  onSelect,
}: {
  points: { key: string; label: string; income: number; expenses: number }[]
  format: (n: number) => string
  onSelect: (key: string) => void
}) {
  const id = useId().replace(/:/g, "")
  return (
    <ChartContainer
      className="aspect-auto h-96 w-full"
      config={{
        income: { label: "Money in", color: "var(--chart-5)" },
        expenses: { label: "Money out", color: "var(--chart-1)" },
      }}
    >
      <BarChart
        data={points}
        margin={{ top: 20, right: 12, bottom: 8, left: 8 }}
      >
        <defs>
          {["income", "expenses"].map((key) => (
            <linearGradient
              key={key}
              id={`${id}-${key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={`var(--color-${key})`} />
              <stop
                offset="100%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.45}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 5" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) =>
            Intl.NumberFormat("en-ZA", { notation: "compact" }).format(v)
          }
          width={54}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              formatter={(v, name) => (
                <span>
                  {name === "income" ? "Money in" : "Money out"}:{" "}
                  {format(Number(v))}
                </span>
              )}
            />
          }
        />
        <Bar
          isAnimationActive={false}
          dataKey="income"
          maxBarSize={28}
          radius={[5, 5, 0, 0]}
          fill={`url(#${id}-income)`}
          onClick={(p) => {
            if (typeof p.payload?.key === "string") onSelect(p.payload.key)
          }}
          className="cursor-pointer"
        >
          {points.map((point) => (
            <Cell
              key={point.key}
              role="button"
              className="focus:stroke-foreground focus:stroke-2"
              tabIndex={point.income === 0 ? -1 : 0}
              aria-label={`${point.label}, Money in: ${format(point.income)}, show transactions`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(point.key)
                }
              }}
            />
          ))}
        </Bar>
        <Bar
          isAnimationActive={false}
          dataKey="expenses"
          maxBarSize={28}
          radius={[5, 5, 0, 0]}
          fill={`url(#${id}-expenses)`}
          onClick={(p) => {
            if (typeof p.payload?.key === "string") onSelect(p.payload.key)
          }}
          className="cursor-pointer"
        >
          {points.map((point) => (
            <Cell
              key={point.key}
              role="button"
              className="focus:stroke-foreground focus:stroke-2"
              tabIndex={point.expenses === 0 ? -1 : 0}
              aria-label={`${point.label}, Money out: ${format(point.expenses)}, show transactions`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(point.key)
                }
              }}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Value-proportional ribbons. Deficit supplies the balancing inflow, surplus the outflow.
 * Columns share one scale; gaps separate categories without changing ribbon thickness. */
export function CashFlowChart({
  incoming,
  outgoing,
  format,
  onSelect,
}: {
  incoming: ChartPart[]
  outgoing: ChartPart[]
  format: (n: number) => string
  onSelect: (key: string) => void
}) {
  const id = useId().replace(/:/g, "")
  const sum = (parts: ChartPart[]) => parts.reduce((n, p) => n + p.value, 0)
  const income = sum(incoming),
    expenses = sum(outgoing),
    total = Math.max(income, expenses)
  if (!total) return null
  const left = [
    ...incoming,
    ...(expenses > income
      ? [{ key: "__deficit", name: "Deficit", value: expenses - income }]
      : []),
  ]
  const right = [
    ...outgoing,
    ...(income > expenses
      ? [{ key: "__surplus", name: "Surplus", value: income - expenses }]
      : []),
  ]
  const gap = 36,
    height = Math.max(360, Math.max(left.length, right.length) * 64)
  const scale =
    (height - 50 - gap * (Math.max(left.length, right.length) - 1)) / total
  const thickness = total * scale,
    centerY = (height - thickness) / 2
  const column = (parts: ChartPart[], side: "left" | "right") => {
    let valueOffset = 0
    const start = (height - thickness - gap * (parts.length - 1)) / 2
    return parts.map((p, index) => {
      const h = p.value * scale,
        y = start + valueOffset + index * gap,
        cy = centerY + valueOffset
      valueOffset += h
      const color =
        p.key === "__surplus"
          ? "var(--chart-3)"
          : p.key === "__deficit"
            ? "var(--warning)"
            : side === "left"
              ? "var(--chart-5)"
              : ANALYSIS_COLORS[index % 5]
      const x1 = side === "left" ? 18 : 470,
        x2 = side === "left" ? 460 : 912
      const sy = side === "left" ? y : cy,
        ty = side === "left" ? cy : y
      const d = `M ${x1} ${sy} C ${x1 + 180} ${sy}, ${x2 - 180} ${ty}, ${x2} ${ty} L ${x2} ${ty + h} C ${x2 - 180} ${ty + h}, ${x1 + 180} ${sy + h}, ${x1} ${sy + h} Z`
      const interactive = !p.key.startsWith("__")
      return (
        <g
          key={p.key}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={`${p.name}: ${format(p.value)}${interactive ? ", show transactions" : ""}`}
          onClick={() => interactive && onSelect(p.key)}
          onKeyDown={(e) => {
            if (interactive && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault()
              onSelect(p.key)
            }
          }}
          className={
            interactive
              ? "cursor-pointer focus:outline-none [&:focus_path]:stroke-foreground [&:hover_path]:opacity-90"
              : ""
          }
        >
          <title>
            {p.name}: {format(p.value)}
          </title>
          <path d={d} fill={color} opacity={0.32} />
          <rect
            x={side === "left" ? 10 : 912}
            y={y}
            width={7}
            height={Math.max(h, 1)}
            rx={3}
            fill={color}
          />
          <text
            x={side === "left" ? 25 : 900}
            y={y + h / 2 - 3}
            textAnchor={side === "left" ? "start" : "end"}
            fill="var(--foreground)"
            fontSize={13}
            fontWeight={500}
          >
            {p.name.length > 30 ? `${p.name.slice(0, 28)}…` : p.name}
          </text>
          <text
            x={side === "left" ? 25 : 900}
            y={y + h / 2 + 14}
            textAnchor={side === "left" ? "start" : "end"}
            fill="var(--muted-foreground)"
            fontSize={11}
          >
            {format(p.value)} · {((p.value / total) * 100).toFixed(1)}%
          </text>
        </g>
      )
    })
  }
  return (
    <div className="overflow-x-auto">
      <svg
        className="w-full min-w-[760px]"
        viewBox={`0 0 930 ${height}`}
        aria-labelledby={`${id}-title`}
      >
        <title id={`${id}-title`}>
          Money flow: {format(income)} in, {format(expenses)} out
        </title>
        {column(left, "left")}
        <rect
          x={460}
          y={centerY}
          width={10}
          height={thickness}
          rx={5}
          fill="var(--chart-2)"
        />
        {column(right, "right")}
      </svg>
    </div>
  )
}
