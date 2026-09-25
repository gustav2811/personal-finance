import type { DeviceRow, ReadingRow } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { isLocalPreview, readLocal } from "@/lib/supabase/local"
import { readDevices, readReadings } from "@/lib/supabase/read"

export type EnergyData = {
  devices: DeviceRow[]
  readings: ReadingRow[]
  fetchedAt: string
}

export async function loadEnergyData(client: BrowserClient): Promise<EnergyData> {
  const [devices, readings] = await Promise.all([readDevices(client), readReadings(client)])
  return { devices, readings, fetchedAt: new Date().toISOString() }
}

export function getEnergyData(): Promise<EnergyData> {
  if (isLocalPreview()) return readLocal<EnergyData>("energy")
  return loadEnergyData(getBrowserClient())
}
