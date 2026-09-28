import type { DeviceRead, ReadingRead } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { readDevices, readReadings } from "@/lib/supabase/read"

export type EnergyData = {
  devices: DeviceRead[]
  readings: ReadingRead[]
  fetchedAt: string
}

export async function loadEnergyData(client: BrowserClient): Promise<EnergyData> {
  const [devices, readings] = await Promise.all([readDevices(client), readReadings(client)])
  return { devices, readings, fetchedAt: new Date().toISOString() }
}

export function getEnergyData(): Promise<EnergyData> {
  return loadEnergyData(getBrowserClient())
}
