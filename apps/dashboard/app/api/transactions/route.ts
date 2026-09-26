import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import type { Database, Json } from "@/lib/supabase/database.types"

type ReadName =
  | "finance_list_transactions_v1"
  | "finance_get_transaction_v1"
  | "finance_get_transaction_filters_v1"

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_KEY"): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function isReadName(name: string): name is ReadName {
  return (
    name === "finance_list_transactions_v1" ||
    name === "finance_get_transaction_v1" ||
    name === "finance_get_transaction_filters_v1"
  )
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true
  }
  if (Array.isArray(value)) return value.every(isJson)
  if (typeof value === "object") {
    return Object.values(value).every((entry) => entry === undefined || isJson(entry))
  }
  return false
}

async function readLedger(
  supabase: SupabaseClient<Database>,
  name: ReadName,
  args: Record<string, unknown>,
) {
  switch (name) {
    case "finance_list_transactions_v1":
      return supabase.rpc(name, {
        p_cursor: typeof args.p_cursor === "string" ? args.p_cursor : undefined,
        p_filters: isJson(args.p_filters) ? args.p_filters : {},
        p_limit: typeof args.p_limit === "number" ? args.p_limit : undefined,
      })
    case "finance_get_transaction_v1":
      return supabase.rpc(name, {
        p_transaction_id: typeof args.p_transaction_id === "string" ? args.p_transaction_id : "",
      })
    case "finance_get_transaction_filters_v1":
      return supabase.rpc(name)
  }
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
    if (!body.name || !isReadName(body.name)) {
      return NextResponse.json({ error: "Unsupported ledger read." }, { status: 400 })
    }

    const supabase = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } },
    )
    const { data, error } = await readLedger(supabase, body.name, body.args ?? {})
    if (error) {
      return NextResponse.json({ error: "The ledger could not be read." }, { status: 502 })
    }
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: "Local ledger bridge is not configured." }, { status: 500 })
  }
}
