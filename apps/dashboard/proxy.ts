import { NextResponse, type NextRequest } from "next/server"
import { demoEnabled } from "@/lib/demo/transactions"
import { updateSession } from "@/lib/supabase/session"

export async function proxy(request: NextRequest) {
  if (demoEnabled()) {
    const { pathname } = request.nextUrl
    if (
      pathname === "/" ||
      pathname === "/utilities" ||
      pathname === "/transactions" ||
      pathname === "/analysis" ||
      pathname === "/api/categories/suggest" ||
      pathname === "/api/dev/analysis-sample" ||
      pathname === "/dev/ui"
    )
      return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = "/transactions"
    url.search = ""
    return NextResponse.redirect(url)
  }
  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
