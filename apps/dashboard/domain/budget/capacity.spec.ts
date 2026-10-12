import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { chartShare, gapWords, projectCapacity, type CapacitySide } from "./capacity"

function known(cents: string): CapacitySide {
  return {
    income: { status: "known", cents },
    contributions: { status: "known", cents: "0" },
  }
}

describe("projectCapacity", () => {
  it("compares agreed and proposed plans without treating a remainder as cash", () => {
    const capacity = projectCapacity({
      agreed: {
        income: { status: "known", cents: "4000000" },
        contributions: { status: "known", cents: "4120000" },
      },
      proposed: {
        income: { status: "known", cents: "4000000" },
        contributions: { status: "known", cents: "3950000" },
      },
      committedScaleCents: null,
      commitScale: true,
    })
    assert.equal(capacity.status, "ready")
    if (capacity.status !== "ready") return
    assert.equal(capacity.scaleCents, "4120000")
    assert.equal(capacity.rows[0]?.readout.includes("over planned income"), true)
    assert.equal(capacity.rows[1]?.readout.includes("not yet planned"), true)
    assert.equal(capacity.rows[1]?.readout.toLowerCase().includes("available to spend"), false)
    assert.equal(chartShare(capacity.rows[0].contributionsCents, capacity.scaleCents), 1000)
    assert.ok(chartShare(capacity.rows[0].incomeCents, capacity.scaleCents) < 1000)
  })

  it("renders zero income against contributions without dividing by zero", () => {
    const capacity = projectCapacity({
      agreed: {
        income: { status: "known", cents: "0" },
        contributions: { status: "known", cents: "120000" },
      },
      proposed: null,
      committedScaleCents: null,
      commitScale: true,
    })
    assert.equal(capacity.status, "ready")
    if (capacity.status !== "ready") return
    assert.equal(capacity.rows[0]?.gapCents, "-120000")
    assert.equal(gapWords("-120000").includes("over planned income"), true)
    assert.equal(chartShare("0", capacity.scaleCents), 0)
    assert.equal(chartShare("120000", capacity.scaleCents), 1000)
  })

  it("omits the comparison when income is missing and does not invent a published row", () => {
    const missing = projectCapacity({
      agreed: known("100"),
      proposed: {
        income: { status: "missing", label: "Expected income is not known." },
        contributions: { status: "known", cents: "100" },
      },
      committedScaleCents: null,
      commitScale: true,
    })
    assert.equal(missing.status, "missing")
    if (missing.status !== "missing") return
    assert.equal(missing.missing.includes("not known"), true)

    const proposedOnly = projectCapacity({
      agreed: null,
      proposed: {
        income: { status: "known", cents: "100" },
        contributions: { status: "known", cents: "40" },
      },
      committedScaleCents: null,
      commitScale: true,
    })
    assert.equal(proposedOnly.status, "ready")
    if (proposedOnly.status !== "ready") return
    assert.deepEqual(proposedOnly.rows.map((row) => row.id), ["proposed"])
  })

  it("keeps the committed scale while a number is pending", () => {
    const capacity = projectCapacity({
      agreed: {
        income: { status: "known", cents: "100" },
        contributions: { status: "pending" },
      },
      proposed: null,
      committedScaleCents: "500",
      commitScale: false,
    })
    assert.deepEqual(capacity, { status: "pending", scaleCents: "500" })
  })

  it("does not compare the old plan against only the new income", () => {
    const capacity = projectCapacity({
      agreed: {
        income: { status: "known", cents: "4000000" },
        contributions: { status: "known", cents: "4120000" },
      },
      proposed: {
        income: { status: "known", cents: "4500000" },
        contributions: { status: "known", cents: "4120000" },
      },
      committedScaleCents: null,
      commitScale: true,
    })
    assert.equal(capacity.status, "ready")
    if (capacity.status !== "ready") return
    assert.equal(capacity.rows[0]?.incomeCents, "4000000")
    assert.equal(capacity.rows[1]?.incomeCents, "4500000")
    assert.notEqual(capacity.rows[0]?.readout, capacity.rows[1]?.readout)
  })
})
