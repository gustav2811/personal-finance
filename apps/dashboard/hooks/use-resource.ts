"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export type ResourceState<T> =
  | { status: "idle" | "loading"; hasData: false; data: undefined; error: null }
  | { status: "ready" | "refreshing"; hasData: true; data: T; error: null }
  | { status: "error"; hasData: boolean; data: T | undefined; error: unknown }

type Snapshot<T> = { key: string; loader: (signal: AbortSignal) => Promise<T>; state: ResourceState<T> }
const loading = { status: "loading", hasData: false, data: undefined, error: null } as const
const idle = { ...loading, status: "idle" } as const

/** Read lifecycle only. A reload resolves after the read settles, including failure;
 * callers must never interpret it as confirmation that a financial command failed.
 * A changed key or loader hides the old snapshot during render, before effects run.
 */
export function useResource<T>({
  key,
  load,
  enabled = true,
  retainData = false,
}: {
  key: string
  load: (signal: AbortSignal) => Promise<T>
  enabled?: boolean
  retainData?: boolean
}) {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({ key, loader: load, state: enabled ? loading : idle }))
  const current = useRef(snapshot)
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const identity = useRef({ key, load, enabled })

  useLayoutEffect(() => {
    identity.current = { key, load, enabled }
  }, [key, load, enabled])

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled || !mounted.current || identity.current.key !== key || identity.current.load !== load || !identity.current.enabled) return
    const sequence = ++request.current
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    const previous = current.current
    const retained = retainData && previous.key === key && previous.loader === load && previous.state.hasData
    const publish = (state: ResourceState<T>) => {
      const next = { key, loader: load, state }
      current.current = next
      setSnapshot(next)
    }
    publish(retained
      ? { status: "refreshing", hasData: true, data: previous.state.data as T, error: null }
      : loading)
    try {
      const data = await load(nextController.signal)
      if (mounted.current && sequence === request.current && !nextController.signal.aborted) {
        publish({ status: "ready", hasData: true, data, error: null })
      }
    } catch (error) {
      if (mounted.current && sequence === request.current && !nextController.signal.aborted) {
        publish({ status: "error", hasData: retained, data: retained ? previous.state.data : undefined, error })
      }
    }
  }, [key, load, enabled, retainData])

  useEffect(() => {
    mounted.current = true
    if (enabled) void reload()
    return () => {
      mounted.current = false
      request.current += 1
      controller.current?.abort()
    }
  }, [reload, enabled])

  const state: ResourceState<T> = !enabled ? idle
    : snapshot.key === key && snapshot.loader === load ? snapshot.state : loading
  return { ...state, reload }
}
