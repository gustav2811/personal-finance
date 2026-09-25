"use client"

import { useState } from "react"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

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
  const [range, setRange] = useState("90")

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="type-label text-muted-foreground">Dev only</p>
          <h1 className="type-page-title">UI foundations</h1>
        </div>
        <ThemeToggle />
      </header>

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
        <div className="grid grid-cols-5 gap-2">
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
        <ToggleGroup
          onValueChange={(value) => {
            if (value) setRange(value)
          }}
          size="sm"
          spacing={0}
          type="single"
          value={range}
          variant="outline"
        >
          <ToggleGroupItem value="30">30 days</ToggleGroupItem>
          <ToggleGroupItem value="90">90 days</ToggleGroupItem>
          <ToggleGroupItem value="365">1 year</ToggleGroupItem>
        </ToggleGroup>
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
    </main>
  )
}
