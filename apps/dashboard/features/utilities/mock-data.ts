import type { EnergyData } from "@/features/utilities/queries"
import type { DeviceRead, LedgerRead, ReadingRead } from "@/lib/supabase/rows"

// Dev-only fixture for /dev/ui. Deterministic, so screenshots and QA runs compare.
const MONTHS_BACK = 20
const DAY_MS = 24 * 60 * 60 * 1000
// Johannesburg is UTC+2 all year, so local midnight is 22:00Z the day before.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

const DEVICES: DeviceRead[] = [
  device("wallet", "ISMRT wallet", "wallet", "wallet", "ismrt"),
  device("meter", "ISMRT meter", "utility_meter", "electricity", "ismrt"),
  device("water", "ISMRT water billing", "utility_stream", "water", "ismrt"),
  device("espresso", "BNETA espresso smart plug", "smart_plug", "electricity", "tuya"),
  device("geyser", "Geyser controller", "smart_plug", "electricity", "tuya"),
  device("pool", "Pool pump", "smart_plug", "electricity", "tuya"),
]

function device(
  id: string,
  name: string,
  kind: string,
  utility: string,
  source: string,
): DeviceRead {
  return {
    active_from: null,
    active_to: null,
    external_id: id,
    id,
    kind,
    location: "Home",
    name,
    source,
    timezone: "Africa/Johannesburg",
    utility_type: utility,
  }
}

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function localMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day) - SAST_OFFSET_MS)
}

export function buildMockEnergyData(now: Date): EnergyData {
  const readings: ReadingRead[] = []
  const ledgerEntries: LedgerRead[] = []
  const today = localMidnight(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const first = localMidnight(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_BACK, 1)
  let monthKwh = 0
  let monthKey = ""
  let sequence = 0

  const addReading = (target: string, deviceId: string, start: Date, kwh: number, unit: "Wh" | "kWh") => {
    sequence += 1
    readings.push({
      device_id: deviceId,
      id: `reading-${sequence}`,
      measurement_target: target,
      metric: "energy",
      period_end: new Date(start.getTime() + DAY_MS).toISOString(),
      period_start: start.toISOString(),
      quality: "measured",
      source: deviceId === "meter" ? "ismrt" : "tuya",
      source_record_id: `mock-${sequence}`,
      unit,
      value: unit === "Wh" ? kwh * 1000 : kwh,
    })
  }

  const addLedger = (entry: Partial<LedgerRead> & Pick<LedgerRead, "amount" | "direction" | "entry_type" | "utility_type">, at: Date, deviceId: string) => {
    sequence += 1
    ledgerEntries.push({
      currency: "ZAR",
      description: null,
      device_id: deviceId,
      id: `ledger-${sequence}`,
      posted_at: at.toISOString(),
      quantity: null,
      rate: null,
      source: "ismrt",
      ...entry,
      occurred_at: at.toISOString(),
    })
  }

  for (let start = first; start < today; start = new Date(start.getTime() + DAY_MS)) {
    const local = new Date(start.getTime() + SAST_OFFSET_MS)
    const year = local.getUTCFullYear()
    const month = local.getUTCMonth()
    const key = `${year}-${month}`
    if (key !== monthKey) {
      monthKey = key
      monthKwh = 0
    }
    const weekday = local.getUTCDay()
    const index = Math.round(start.getTime() / DAY_MS)

    // Winter draws more. Tuesday is housekeeper day. Weekends are busier at the plug.
    const winter = month >= 4 && month <= 7 ? 3 : 0
    const tuesday = weekday === 2 ? 5 : 0
    const espresso = 1 + noise(index) * 0.5 + (weekday === 0 || weekday === 6 ? 0.4 : 0)
    const geyser = 4 + winter * 0.6 + noise(index + 7) * 1.5
    const pool = month >= 9 || month <= 2 ? 2.2 + noise(index + 3) * 0.4 : 0
    const home = 6 + winter + tuesday + espresso + geyser + pool + noise(index + 11) * 3

    addReading("whole_home", "meter", start, home, "Wh")
    // The plug was fitted mid-history and dropped out for a stretch, like the real Tuya gaps.
    const recentGap = now.getTime() - start.getTime() < 12 * DAY_MS && index % 3 !== 0
    if (!recentGap) addReading("lelit-bianca", "espresso", start, espresso, "kWh")
    addReading("geyser", "geyser", start, geyser, "kWh")
    if (pool > 0) addReading("pool-pump", "pool", start, pool, "kWh")

    // City Power steps up each July. The rate climbs into a dearer block past 350 kWh.
    const monthIndex = year * 12 + month
    const baseRate =
      monthIndex >= 2026 * 12 + 6 ? 3.315105 : monthIndex >= 2025 * 12 + 6 ? 3.04106 : 2.79
    monthKwh += home
    const rate = monthKwh > 350 ? baseRate * 1.18 : baseRate
    addLedger(
      {
        amount: home * rate,
        direction: "debit",
        entry_type: "usage_charge",
        quantity: home,
        rate,
        utility_type: "electricity",
      },
      start,
      "meter",
    )
    addLedger(
      { amount: 2.03, direction: "debit", entry_type: "fee", utility_type: "wallet" },
      start,
      "wallet",
    )
    if (index % 9 === 0) {
      const at = new Date(start.getTime() + 15 * 60 * 60 * 1000)
      addLedger(
        { amount: 700, direction: "credit", entry_type: "deposit", utility_type: "wallet" },
        at,
        "wallet",
      )
      addLedger(
        { amount: 8, direction: "debit", entry_type: "fee", utility_type: "wallet" },
        at,
        "wallet",
      )
    }

    // Water is invoiced for a closed month, so the open month has no invoice yet.
    if (local.getUTCDate() === 1 && monthIndex < now.getUTCFullYear() * 12 + now.getUTCMonth()) {
      const kl = 7 + noise(index) * 3
      const amount = kl * (year === 2026 && month >= 6 ? 26 : 22)
      // Two debits and a matching credit, as ISMRT posts a corrected invoice.
      const water = { entry_type: "usage_charge", utility_type: "water" } as const
      addLedger({ ...water, amount, direction: "debit", quantity: kl }, start, "water")
      if (month === 3) {
        addLedger({ ...water, amount, direction: "debit" }, start, "water")
        addLedger({ ...water, amount, direction: "credit" }, start, "water")
      }
    }
  }

  return { devices: DEVICES, fetchedAt: now.toISOString(), ledgerEntries, readings }
}
