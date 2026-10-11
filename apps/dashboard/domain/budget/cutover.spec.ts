import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { explainOpening, readOpeningReasons } from "./cutover"

const CHEQUE = "00000000-0000-4000-8000-0000000000a1"
const NOTICE = "00000000-0000-4000-8000-0000000000a2"

describe("explainOpening", () => {
  it("keeps an incomplete opening specific to each account", () => {
    const reasons = readOpeningReasons([
      { code: "snapshot_missing", account_id: CHEQUE },
      { code: "sign_convention_unknown", account_id: CHEQUE },
      { code: "restricted_resources_unverified", account_id: NOTICE },
      { code: "utilities_unverified" },
      { code: "snapshot_missing", account_id: CHEQUE },
    ])
    const explanation = explainOpening({
      status: "incomplete",
      reasons,
      accounts: [
        { id: CHEQUE, name: "Cheque" },
        { id: NOTICE, name: "Notice" },
      ],
    })

    assert.equal(explanation.complete, false)
    assert.match(explanation.headline, /still incomplete/)
    assert.equal(explanation.findings[0]?.accountName, "Cheque")
    assert.match(explanation.findings[0]?.sentences.join(" ") ?? "", /no balance to agree/)
    assert.match(explanation.findings[0]?.sentences.join(" ") ?? "", /sign of money/)
    assert.equal(explanation.findings[1]?.accountName, "Notice")
    assert.match(explanation.findings[1]?.sentences.join(" ") ?? "", /cannot pay a bill/)
    assert.equal(explanation.findings[2]?.accountName, "This opening")
    assert.match(explanation.notice, /Cheque:/)
    assert.equal(explanation.notice.includes(CHEQUE), false)
    assert.equal(explanation.notice.toLowerCase().includes("fingerprint"), false)
  })

  it("says an opening is agreed only when nothing remains unresolved", () => {
    const explanation = explainOpening({ status: "complete", reasons: [], accounts: [] })

    assert.equal(explanation.complete, true)
    assert.equal(explanation.findings.length, 0)
    assert.match(explanation.headline, /agreed/)
  })
})
