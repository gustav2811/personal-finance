import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { loadDashboardData, type DashboardScope } from "@/lib/data";
import type { Database } from "@/lib/supabase-browser";

const SCOPES = new Set<DashboardScope>(["overview", "energy", "money", "sources"]);

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local bridge disabled." }, { status: 404 });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  if (!scope || !SCOPES.has(scope as DashboardScope)) {
    return NextResponse.json({ error: "Unknown dashboard scope." }, { status: 400 });
  }

  try {
    const supabase = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } },
    );
    const data = await loadDashboardData(supabase, scope as DashboardScope);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Local dashboard data bridge is not configured." },
      { status: 500 },
    );
  }
}
