import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import { renderToStaticMarkup } from "react-dom/server"
import { FactGrid } from "./fact-grid"

test("facts expose associated terms and descriptions, including unknown values", () => {
  const dom = new JSDOM(renderToStaticMarkup(<FactGrid items={[
    { label: "Usage", value: "0 kWh", detail: "Closed days only" },
    { label: "Budget", value: "Unknown", detail: "Reconciliation required", tone: "warning" },
  ]} />))
  try {
    const list = dom.window.document.querySelector("dl")!
    const terms = Array.from(list.querySelectorAll("dt"))
    assert.deepEqual(terms.map((term) => term.textContent), ["Usage", "Budget"])
    assert.equal(terms[0].nextElementSibling?.tagName, "DD")
    assert.equal(terms[1].nextElementSibling?.tagName, "DD")
    assert.match(terms[0].nextElementSibling!.textContent!, /0 kWh.*Closed days only/)
    assert.match(terms[1].nextElementSibling!.textContent!, /Unknown.*Reconciliation required/)
  } finally {
    dom.window.close()
  }
})
