import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local bridge disabled." }, { status: 404 });
  }

  try {
    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } },
    );
    const { data, error } = await supabase.rpc("get_local_dashboard_data");
    if (error || !data) {
      return NextResponse.json(
        { error: "Unable to read household data." },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Local dashboard data bridge is not configured." },
      { status: 500 },
    );
  }
}
