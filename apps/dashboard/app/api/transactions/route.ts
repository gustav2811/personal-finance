import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import type { Database } from "@/lib/supabase/database.types"

const READ_RPCS = new Set([
  "finance_list_transactions_v1",
  "finance_get_transaction_v1",
  "finance_get_transaction_filters_v1",
  "finance_get_transaction_activity_v1",
])

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_KEY"): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local bridge disabled." }, { status: 404 })
  }

  try {
    const body = (await request.json()) as {
      name?: string
      args?: Record<string, unknown>
    }
    if (!body.name || !READ_RPCS.has(body.name)) {
      return NextResponse.json({ error: "Unsupported ledger read." }, { status: 400 })
    }

    const supabase = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } },
    )
    const { data, error } = await supabase.rpc(body.name as never, (body.args ?? {}) as never)
    if (error) {
      return NextResponse.json({ error: "The ledger could not be read." }, { status: 502 })
    }
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: "Local ledger bridge is not configured." }, { status: 500 })
  }
}
