import type { DeviceRead, IngestionRunRead, ReadingRead } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { isLocalPreview, readLocal } from "@/lib/supabase/local"
import { readDevices, readIngestionRuns, readReadings } from "@/lib/supabase/read"

export type SourcesData = {
  devices: DeviceRead[]
  readings: ReadingRead[]
  ingestionRuns: IngestionRunRead[]
  fetchedAt: string
}

export async function loadSourcesData(client: BrowserClient): Promise<SourcesData> {
  const [devices, readings, ingestionRuns] = await Promise.all([
    readDevices(client),
    readReadings(client),
    readIngestionRuns(client),
  ])
  return { devices, readings, ingestionRuns, fetchedAt: new Date().toISOString() }
}

export function getSourcesData(): Promise<SourcesData> {
  if (isLocalPreview()) return readLocal<SourcesData>("sources")
  return loadSourcesData(getBrowserClient())
}
