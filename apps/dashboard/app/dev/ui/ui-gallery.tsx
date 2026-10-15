"use client"

import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChartEmpty } from "@/components/patterns/chart-empty"
import { ChartTooltipSurface } from "@/components/patterns/chart-tooltip-surface"
import { FactGrid } from "@/components/patterns/fact-grid"
import { PageHeader } from "@/components/patterns/page-header"
import { RangeControl } from "@/components/patterns/range-control"
import { Section } from "@/components/patterns/section"
import { HistoryControl } from "@/components/patterns/history-control"
import { EnergyPanel } from "@/features/utilities/energy-panel"
import { buildMockEnergyData } from "@/features/utilities/mock-data"
import { WaterPanel } from "@/features/utilities/water-panel"
import type { RangeDays, HistoryWindow } from "@/lib/range"
import { ResourceExamples } from "./resource-examples"

const SWATCHES = [
  ["shocking-pink", "bg-shocking-pink-500"],
  ["violet-ray", "bg-violet-ray-500"],
  ["electric-blue", "bg-electric-blue-500"],
  ["deep-sky-blue", "bg-deep-sky-blue-500"],
  ["electric-cyan", "bg-electric-cyan-500"],
] as const

const chartConfig = {
  pink: { color: "var(--chart-1)", label: "Pink" },
  violet: { color: "var(--chart-2)", label: "Violet" },
} satisfies ChartConfig

export function UiGallery() {
  const [range, setRange] = useState<RangeDays>(90)
  const [history, setHistory] = useState<HistoryWindow>(6)
  const mock = useMemo(() => buildMockEnergyData(new Date()), [])

  return (
    <main className="@container/utilities mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-10 p-4 md:p-6">
      <PageHeader
        title="Household UI reference"
        description="Development-only fixtures. Start with shared patterns; keep formatting and decisions in the feature."
        actions={<ThemeToggle />}
      />

      <Section title="Build a household screen" description="PageHeader → controls → Section → domain content. These are the production components, with illustrative values.">
        <div className="flex flex-wrap items-center gap-3">
          <RangeControl onChange={setRange} value={range} />
          <span className="type-caption">Controls own selection; features own its meaning.</span>
        </div>
        <FactGrid items={[
          { label: "Usage", value: "235.4 kWh", detail: "Closed days only" },
          { label: "Cost", value: "R780", detail: "Incurred charges" },
          { label: "Reconciliation", value: "Needs attention", detail: "Do not turn unknown values into zero.", tone: "warning" },
        ]} />
        <FactGrid compact items={[
          { label: "Projected month end", value: "521 kWh", detail: "R1 728" },
          { label: "Highest day", value: "22.4 kWh", detail: "06 Oct" },
          { label: "Daily average", value: "16.8 kWh" },
        ]} />
      </Section>

      <ResourceExamples />

      <Section title="Chart states" description="Use ChartTooltipContent for ordinary series. Use the shared surface only when the content needs a custom layout.">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <ChartEmpty title="No readings in this range" description="Choose a longer range to check earlier readings." />
          <div className="flex items-center justify-center p-4">
            <ChartTooltipSurface className="grid gap-1">
              <p className="font-medium">14 Oct</p>
              <p>Usage: 16.8 kWh</p>
              <p>Cost: R56</p>
            </ChartTooltipSurface>
          </div>
        </div>
      </Section>

      <section className="space-y-2">
        <h2 className="type-section-title">Typography</h2>
        <p className="type-display">Display</p>
        <p className="type-page-title">Page title</p>
        <p className="type-body">Body copy for operational pages.</p>
        <p className="type-caption">Caption</p>
        <p className="type-numeric text-lg">R1 234.00</p>
      </section>

      <section className="space-y-2">
        <h2 className="type-section-title">Accent palette</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, tone]) => (
            <div key={name} className="space-y-1">
              <div className={`${tone} h-16 rounded-md`} />
              <p className="type-caption">{name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="type-section-title">Controls</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="gallery-input">Input</Label>
          <Input id="gallery-input" placeholder="Merchant or description" />
        </div>
        <Select defaultValue="home">
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="home">Whole home</SelectItem>
            <SelectItem value="espresso">Espresso</SelectItem>
          </SelectContent>
        </Select>
        <RangeControl onChange={setRange} value={range} />
      </section>

      <section className="space-y-3">
        <h2 className="type-section-title">Feedback</h2>
        <Alert>
          <AlertTitle>Info</AlertTitle>
          <AlertDescription>A quiet operational note.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Failed</AlertTitle>
          <AlertDescription>Use destructive, not a custom red.</AlertDescription>
        </Alert>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Nothing here</EmptyTitle>
            <EmptyDescription>Empty states stay inside this primitive.</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog</DialogTitle>
                <DialogDescription>Reserved for interruption, not a single field.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Sheet</SheetTitle>
                <SheetDescription>Narrow detail, not a second squeezed column.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="type-section-title">Table and chart</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Reading</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Whole home</TableCell>
              <TableCell className="type-numeric text-right">12.4 kWh</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <ChartContainer className="aspect-auto h-40 w-full" config={chartConfig}>
          <BarChart data={[{ label: "Mon", pink: 4, violet: 2 }]}>
            <CartesianGrid vertical={false} />
            <XAxis axisLine={false} dataKey="label" tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="pink" fill="var(--color-pink)" radius={4} />
            <Bar dataKey="violet" fill="var(--color-violet)" radius={4} />
          </BarChart>
        </ChartContainer>
      </section>

      <section className="space-y-6" id="utilities-mock">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="type-section-title">Utilities with mock data</h2>
          </div>
          <HistoryControl onChange={setHistory} value={history} />
        </div>
        <EnergyPanel data={mock} window={history} />
        <h3 className="type-section-title">Water</h3>
        <WaterPanel data={mock} window={history} />
      </section>
    </main>
  )
}
