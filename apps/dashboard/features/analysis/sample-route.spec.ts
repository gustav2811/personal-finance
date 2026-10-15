import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { GET } from "../../app/api/dev/analysis-sample/route"

test("local snapshot is date-filtered, never cached, and unavailable outside explicit development", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "analysis-snapshot-test-"),
  )
  const originalCwd = process.cwd
  const originalNodeEnv = process.env.NODE_ENV
  const originalSample = process.env.DASHBOARD_ANALYSIS_SAMPLE
  const originalDemo = process.env.DASHBOARD_DEMO_MODE
  try {
    process.cwd = () => directory
    Object.assign(process.env, {
      NODE_ENV: "development",
      DASHBOARD_DEMO_MODE: "true",
      DASHBOARD_ANALYSIS_SAMPLE: "true",
    })
    const request = new Request(
      "http://localhost/api/dev/analysis-sample?from=2026-10-01&to=2026-10-31",
    )
    assert.equal((await GET(request)).status, 404)
    await mkdir(path.join(directory, ".local"))
    await writeFile(
      path.join(directory, ".local", "analysis-sample.json"),
      JSON.stringify({
        transactions: [
          { id: "oct", occurredOn: "2026-10-10" },
          { id: "sep", occurredOn: "2026-09-10" },
        ],
        accounts: [],
        categories: [],
        sample: {
          fetchedAt: "2026-10-14T00:00:00Z",
          from: "2026-09-01",
          to: "2026-10-31",
          count: 2,
        },
      }),
    )
    const response = await GET(request)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    const data = await response.json()
    assert.deepEqual(
      data.transactions.map((t: { id: string }) => t.id),
      ["oct"],
    )
    assert.equal(data.sample.count, 2)
    assert.equal((await GET(new Request(request.url, { headers: { host: "example.com" } }))).status, 404)
    assert.equal((await GET(new Request(request.url, { headers: { host: "localhost:3100", "x-forwarded-host": "example.com" } }))).status, 404)
    assert.equal(
      (
        await GET(
          new Request(
            "http://localhost/api/dev/analysis-sample?from=invalid&to=2026-10-31",
          ),
        )
      ).status,
      400,
    )
    assert.equal(
      (
        await GET(
          new Request(
            "http://example.com/api/dev/analysis-sample?from=2026-10-01&to=2026-10-31",
          ),
        )
      ).status,
      404,
    )
    process.env.DASHBOARD_ANALYSIS_SAMPLE = "false"
    assert.equal((await GET(request)).status, 404)
    process.env.DASHBOARD_ANALYSIS_SAMPLE = "true"
    process.env.DASHBOARD_DEMO_MODE = "false"
    assert.equal((await GET(request)).status, 404)
    Object.assign(process.env, {
      NODE_ENV: "production",
      DASHBOARD_DEMO_MODE: "true",
      DASHBOARD_ANALYSIS_SAMPLE: "true",
    })
    assert.equal((await GET(request)).status, 404)
  } finally {
    if (originalSample === undefined) delete process.env.DASHBOARD_ANALYSIS_SAMPLE
    else process.env.DASHBOARD_ANALYSIS_SAMPLE = originalSample
    process.cwd = originalCwd
    if (originalNodeEnv === undefined)
      Reflect.deleteProperty(process.env, "NODE_ENV")
    else Object.assign(process.env, { NODE_ENV: originalNodeEnv })
    if (originalDemo === undefined) delete process.env.DASHBOARD_DEMO_MODE
    else process.env.DASHBOARD_DEMO_MODE = originalDemo
    await rm(directory, { recursive: true, force: true })
  }
})
