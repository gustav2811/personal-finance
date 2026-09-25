import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { loadEnergyData } from "@/features/energy/queries"
import { loadMoneyData } from "@/features/money/queries"
import { loadOverviewData } from "@/features/overview/queries"
import { loadSourcesData } from "@/features/sources/queries"
import type { Database } from "@/lib/supabase/database.types"

const LOADERS = {
  overview: loadOverviewData,
  energy: loadEnergyData,
  money: loadMoneyData,
  sources: loadSourcesData,
} as const

type Scope = keyof typeof LOADERS

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_KEY"): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}.`)
  }
  return value
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local bridge disabled." }, { status: 404 })
  }

  const scope = new URL(request.url).searchParams.get("scope")
  if (!scope || !(scope in LOADERS)) {
    return NextResponse.json({ error: "Unknown dashboard scope." }, { status: 400 })
  }

  try {
    const supabase = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } },
    )
    const data = await LOADERS[scope as Scope](supabase)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: "Local dashboard data bridge is not configured." },
      { status: 500 },
    )
  }
}
