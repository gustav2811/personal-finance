import "../features/transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { useResource } from "./use-resource"

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test("failure → retry → success clears the error", async () => {
  let attempts = 0
  const load = async () => { if (++attempts === 1) throw new Error("offline"); return 7 }
  const { result } = renderHook(() => useResource({ key: "a", load }))
  await waitFor(() => assert.equal(result.current.status, "error"))
  await act(() => result.current.reload())
  assert.equal(result.current.status, "ready")
  assert.equal(result.current.data, 7)
  assert.equal(result.current.error, null)
})

test("same-resource refresh retains data, and failure does not imply an empty success", async () => {
  const next = deferred<number>()
  let attempts = 0
  const load = async () => ++attempts === 1 ? 7 : next.promise
  const { result } = renderHook(() => useResource({ key: "a", load, retainData: true }))
  await waitFor(() => assert.equal(result.current.status, "ready"))
  let pending!: Promise<void>
  act(() => { pending = result.current.reload() })
  assert.equal(result.current.status, "refreshing")
  assert.equal(result.current.data, 7)
  await act(async () => { next.reject(new Error("offline")); await pending })
  const settled = result.current as ReturnType<typeof useResource<number>>
  assert.equal(settled.status, "error")
  assert.equal(settled.hasData, true)
  assert.equal(settled.data, 7)
})

test("newest request wins even when aborted transport resolves later", async () => {
  const first = deferred<number>()
  const second = deferred<number>()
  const signals: AbortSignal[] = []
  const load = (signal: AbortSignal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise }
  const { result } = renderHook(() => useResource({ key: "a", load }))
  let retry!: Promise<void>
  act(() => { retry = result.current.reload() })
  assert.equal(signals[0].aborted, true)
  await act(async () => { second.resolve(2); await retry })
  await act(async () => { first.resolve(1); await first.promise })
  assert.equal(result.current.data, 2)
})

test("changing identity hides old data in the render before cleanup", async () => {
  const first = deferred<number>()
  const second = deferred<number>()
  let calls = 0
  const load = () => ++calls === 1 ? first.promise : second.promise
  const renders: Array<{ key: string; data: number | undefined }> = []
  const { result, rerender } = renderHook(({ identity }) => {
    const resource = useResource({ key: identity, load, retainData: true })
    renders.push({ key: identity, data: resource.data })
    return resource
  }, { initialProps: { identity: "a" } })
  await act(async () => { first.resolve(1); await first.promise })
  rerender({ identity: "b" })
  assert.equal(renders.filter((entry) => entry.key === "b").every((entry) => entry.data === undefined), true)
  await act(async () => { second.resolve(2); await second.promise })
  assert.equal(result.current.data, 2)
})

test("nullable and empty results are loaded successes", async () => {
  const load = async () => null
  const empty = async () => [] as number[]
  const nullable = renderHook(() => useResource({ key: "null", load }))
  const list = renderHook(() => useResource({ key: "empty", load: empty }))
  await waitFor(() => assert.equal(nullable.result.current.status, "ready"))
  await waitFor(() => assert.equal(list.result.current.status, "ready"))
  assert.equal(nullable.result.current.hasData, true)
  assert.equal(nullable.result.current.data, null)
  assert.deepEqual(list.result.current.data, [])
})

test("an old mutation callback cannot reload a selection that is no longer displayed", async () => {
  let reads = 0
  const load = async () => ++reads
  const { result, rerender } = renderHook(({ identity }) => useResource({ key: identity, load }), { initialProps: { identity: "a" } })
  await waitFor(() => assert.equal(result.current.status, "ready"))
  const oldReload = result.current.reload
  rerender({ identity: "b" })
  await waitFor(() => assert.equal(result.current.data, 2))
  await act(() => oldReload())
  assert.equal(reads, 2)
  assert.equal(result.current.data, 2)
  assert.equal(result.current.status, "ready")
})

test("disabled resources do not read and unmount aborts an active read", async () => {
  const pending = deferred<number>()
  const signals: AbortSignal[] = []
  const load = (signal: AbortSignal) => { signals.push(signal); return pending.promise }
  const { result, rerender, unmount } = renderHook(({ enabled }) => useResource({ key: "a", load, enabled }), { initialProps: { enabled: false } })
  assert.equal(result.current.status, "idle")
  await act(() => result.current.reload())
  assert.equal(signals.length, 0)
  rerender({ enabled: true })
  assert.equal(signals.length, 1)
  unmount()
  assert.equal(signals[0].aborted, true)
  await act(async () => { pending.resolve(1); await pending.promise })
})

test("refresh retries repeat reads, not a preceding successful command", async () => {
  let writes = 0
  let reads = 0
  const load = async () => { if (++reads === 2) throw new Error("offline"); return reads }
  const write = async () => { writes += 1 }
  const { result } = renderHook(() => useResource({ key: "a", load, retainData: true }))
  await waitFor(() => assert.equal(result.current.status, "ready"))
  await act(async () => { await write(); await result.current.reload() })
  assert.equal(result.current.status, "error")
  await act(() => result.current.reload())
  assert.equal(result.current.status, "ready")
  assert.equal(writes, 1)
  assert.equal(reads, 3)
})
