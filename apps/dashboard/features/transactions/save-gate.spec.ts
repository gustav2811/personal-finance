import assert from "node:assert/strict"
import { test } from "node:test"
import { createSaveGate } from "./save-gate"

test("Next waits for the active autosave without issuing a second write", async () => {
  const save = createSaveGate()
  let complete!: (success: boolean) => void
  let calls = 0
  const first = save(() => { calls++; return new Promise<boolean>((resolve) => { complete = resolve }) })
  const next = save(async () => { calls++; return true })
  assert.equal(first, next)
  let navigated = false
  const navigation = next.then((ok) => { if (ok) navigated = true })
  await Promise.resolve()
  assert.equal(navigated, false)
  complete(true)
  await navigation
  assert.equal(navigated, true)
  assert.equal(calls, 1)
})

test("a failed save prevents navigation and allows an explicit retry", async () => {
  const save = createSaveGate()
  assert.equal(await save(async () => false), false)
  assert.equal(await save(async () => true), true)
})

test("a rejected request releases the gate for retry", async () => {
  const save = createSaveGate()
  await assert.rejects(save(async () => { throw new Error("Offline") }), /Offline/)
  assert.equal(await save(async () => true), true)
})
