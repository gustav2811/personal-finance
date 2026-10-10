import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { cycleContaining, cycleLabel } from "./cycle"

describe("cycleContaining", () => {
  it("uses the 23rd inclusive and the next 23rd exclusive", () => {
    assert.deepEqual(cycleContaining("2026-10-10"), {
      start: "2026-09-23",
      endExclusive: "2026-10-23",
    })
    assert.deepEqual(cycleContaining("2026-10-23"), {
      start: "2026-10-23",
      endExclusive: "2026-11-23",
    })
    assert.deepEqual(cycleContaining("2026-10-22"), {
      start: "2026-09-23",
      endExclusive: "2026-10-23",
    })
    assert.equal(cycleLabel("2026-09-23", "2026-10-23"), "23 Sept – 22 Oct")
  })

  it("crosses the year boundary", () => {
    assert.deepEqual(cycleContaining("2027-01-10"), {
      start: "2026-12-23",
      endExclusive: "2027-01-23",
    })
  })
})
