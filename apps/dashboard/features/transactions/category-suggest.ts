import { useEffect, useRef, useState } from "react"
import type { CategoryOption } from "./model"

export type RankedCategory = { id: string; probability: number }

const MIN_QUERY = 3
const MIN_PROBABILITY = 0.02
const MAX_SEMANTIC = 5
const DEBOUNCE_MS = 250

async function fetchRanking(text: string, signal: AbortSignal): Promise<RankedCategory[]> {
  const response = await fetch("/api/categories/suggest", {
    body: JSON.stringify({ text }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  })
  if (!response.ok) throw new Error(`Suggest HTTP ${response.status}`)
  const body = (await response.json()) as { ranked?: RankedCategory[] }
  return body.ranked ?? []
}

export function useCategoryRanking(query: string): { ranking: RankedCategory[] | null; loading: boolean } {
  const cache = useRef(new Map<string, RankedCategory[]>())
  const [state, setState] = useState<{ key: string; ranking: RankedCategory[] | null; loading: boolean }>({
    key: "",
    loading: false,
    ranking: null,
  })
  const key = query.trim().toLowerCase()

  useEffect(() => {
    if (key.length < MIN_QUERY) return
    const cached = cache.current.get(key)
    if (cached) {
      setState({ key, loading: false, ranking: cached })
      return
    }
    setState({ key, loading: true, ranking: null })
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetchRanking(key, controller.signal)
        .then((ranking) => {
          cache.current.set(key, ranking)
          setState({ key, loading: false, ranking })
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ key, loading: false, ranking: null })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  if (key.length < MIN_QUERY || state.key !== key) return { loading: key.length >= MIN_QUERY, ranking: null }
  return { loading: state.loading, ranking: state.ranking }
}

export function rankCategories(
  categories: CategoryOption[],
  query: string,
  ranking: RankedCategory[] | null,
): { items: CategoryOption[]; probabilityById: Map<string, number> } {
  const needle = query.trim().toLowerCase()
  if (!needle) return { items: categories, probabilityById: new Map() }
  const probabilityById = new Map((ranking ?? []).map((entry) => [entry.id, entry.probability]))
  const byId = new Map(categories.map((category) => [category.id, category]))
  const lexical = categories
    .filter((category) => `${category.name} ${category.group ?? ""}`.toLowerCase().includes(needle))
    .sort((first, second) => (probabilityById.get(second.id) ?? 0) - (probabilityById.get(first.id) ?? 0))
  const seen = new Set(lexical.map((category) => category.id))
  const semantic = (ranking ?? [])
    .filter((entry) => entry.probability >= MIN_PROBABILITY && !seen.has(entry.id))
    .slice(0, MAX_SEMANTIC)
    .flatMap((entry) => {
      const category = byId.get(entry.id)
      return category ? [category] : []
    })
  return { items: [...lexical, ...semantic], probabilityById }
}
