import type { DeviceRead, LedgerRead, ReadingRead, SnapshotRead } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { isLocalPreview, readLocal } from "@/lib/supabase/local"
import { readDevices, readLatestSnapshot, readLedger, readReadings } from "@/lib/supabase/read"

export type OverviewData = {
  devices: DeviceRead[]
  readings: ReadingRead[]
  ledgerEntries: LedgerRead[]
  financialSnapshots: SnapshotRead[]
  fetchedAt: string
}

export async function loadOverviewData(client: BrowserClient): Promise<OverviewData> {
  const [devices, readings, ledgerEntries, latest] = await Promise.all([
    readDevices(client),
    readReadings(client),
    readLedger(client),
    readLatestSnapshot(client),
  ])
  return {
    devices,
    readings,
    ledgerEntries,
    financialSnapshots: latest.snapshot ? [latest.snapshot] : [],
    fetchedAt: new Date().toISOString(),
  }
}

export function getOverviewData(): Promise<OverviewData> {
  if (isLocalPreview()) return readLocal<OverviewData>("overview")
  return loadOverviewData(getBrowserClient())
}
