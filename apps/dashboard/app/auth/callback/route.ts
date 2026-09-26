import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

function safeNext(value: string | null, origin: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/"
  }
  try {
    const target = new URL(value, origin)
    if (target.origin !== origin) return "/"
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/"
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const next = safeNext(url.searchParams.get("next"), url.origin)

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin))
  }

  const response = NextResponse.redirect(new URL(next, url.origin))
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0")
  response.headers.set("Expires", "0")
  response.headers.set("Pragma", "no-cache")
  return response
}
