import type { DeviceRead, LedgerRead, SnapshotRead } from "@/lib/supabase/rows"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import { countTransactions, readDevices, readLatestSnapshot, readLedger } from "@/lib/supabase/read"

export type WalletData = {
  devices: DeviceRead[]
  ledgerEntries: LedgerRead[]
  financialTransactionCount: number
  financialSnapshots: SnapshotRead[]
  financialError: string | null
  fetchedAt: string
}

export async function loadWalletData(client: BrowserClient): Promise<WalletData> {
  const [devices, ledgerEntries, counted, latest] = await Promise.all([
    readDevices(client),
    readLedger(client),
    countTransactions(client),
    readLatestSnapshot(client),
  ])
  return {
    devices,
    ledgerEntries,
    financialTransactionCount: counted.count,
    financialSnapshots: latest.snapshot ? [latest.snapshot] : [],
    financialError: counted.error ?? latest.error,
    fetchedAt: new Date().toISOString(),
  }
}

export function getWalletData(): Promise<WalletData> {
  return loadWalletData(getBrowserClient())
}
