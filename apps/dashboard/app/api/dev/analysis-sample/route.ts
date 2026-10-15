import { readFile } from "node:fs/promises"
import path from "node:path"
import { demoEnabled } from "@/lib/demo/transactions"
import type { AnalysisData } from "@/features/analysis/model"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Host" }

/** Local, read-only preview. No credentials and no database connection. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  // Next normalizes request.url to its bind address; inspect the original host
  // headers too. This rejects remote hosts, but loopback binding is still required.
  const isLocalHost = (value: string) => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(value)
  const forwardedHost = request.headers.get("x-forwarded-host")
  if (
    !demoEnabled() ||
    process.env.DASHBOARD_ANALYSIS_SAMPLE !== "true" ||
    !isLocalHost(request.headers.get("host") ?? url.host) ||
    (forwardedHost !== null && !isLocalHost(forwardedHost)) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return new Response(null, { status: 404, headers: privateHeaders })
  }
  const from = url.searchParams.get("from") ?? ""
  const to = url.searchParams.get("to") ?? ""
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  ) {
    return new Response("Invalid date window", {
      status: 400,
      headers: privateHeaders,
    })
  }
  try {
    const sample = JSON.parse(
      await readFile(
        path.join(process.cwd(), ".local", "analysis-sample.json"),
        "utf8",
      ),
    ) as AnalysisData
    return Response.json(
      {
        ...sample,
        transactions: sample.transactions.filter(
          (t) => t.occurredOn >= from && t.occurredOn <= to,
        ),
      },
      { headers: privateHeaders },
    )
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT"
    return new Response(null, {
      status: missing ? 404 : 500,
      headers: privateHeaders,
    })
  }
}
