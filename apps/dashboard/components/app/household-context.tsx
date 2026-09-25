"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { DashboardData } from "@/lib/data"

type HouseholdContextValue = {
  data: DashboardData | null
  dataError: string | null
  email: string
  isLocalPreview: boolean
  signIn: () => void
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function HouseholdProvider({
  children,
  value,
}: {
  children: ReactNode
  value: HouseholdContextValue
}) {
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext)
  if (!value) {
    throw new Error("useHousehold must be used within the application shell.")
  }
  return value
}
