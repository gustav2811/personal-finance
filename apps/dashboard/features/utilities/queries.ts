import type { DeviceRead, LedgerRead, ReadingRead } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { readDevices, readLedgerHistory, readReadingsHistory } from "@/lib/supabase/read"

export type EnergyData = {
  devices: DeviceRead[]
  readings: ReadingRead[]
  ledgerEntries: LedgerRead[]
  fetchedAt: string
}

export async function loadEnergyData(client: BrowserClient): Promise<EnergyData> {
  const [devices, readings, ledgerEntries] = await Promise.all([
    readDevices(client),
    readReadingsHistory(client),
    readLedgerHistory(client),
  ])
  return { devices, readings, ledgerEntries, fetchedAt: new Date().toISOString() }
}

export function getEnergyData(): Promise<EnergyData> {
  return loadEnergyData(getBrowserClient())
}
