"use client"

import type { ReactNode } from "react"
import { AppShell } from "@/components/shell/app-shell"

export default function HouseholdLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
