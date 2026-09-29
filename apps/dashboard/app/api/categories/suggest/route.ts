import { CATEGORY_CRITERIA } from "../../../../../../libs/categoriser/src/criteria"
import { createClient } from "@/lib/supabase/server"
import type { CategoryOption } from "@/features/transactions/model"

const GATEWAY_ID = "household-frontend"
const MAX_TEXT = 80

type JevChoiceAnswer = {
  type: "choice"
  probabilities: Record<string, number>
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function categoryAnswer(payload: unknown): JevChoiceAnswer {
  if (!isRecord(payload) || !isRecord(payload.result)) throw new Error("Jev response was not an object")
  const body = isRecord(payload.result.result) ? payload.result.result : payload.result
  const answer = isRecord(body.answers) ? body.answers.category : null
  if (!isRecord(answer) || answer.type !== "choice" || !isRecord(answer.probabilities)) {
    throw new Error("Jev response missing category answer")
  }
  const probabilities: Record<string, number> = {}
  for (const [key, value] of Object.entries(answer.probabilities)) {
    if (typeof value === "number" && Number.isFinite(value)) probabilities[key] = value
  }
  return { type: "choice", probabilities }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null)
  const text = isRecord(body) && typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : ""
  if (text.length < 2) return Response.json({ error: "Expected { text }" }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("finance_get_transaction_filters_v1")
  if (error) return Response.json({ error: "Categories could not be read." }, { status: 403 })
  const categories = (isRecord(data) && Array.isArray(data.categories) ? data.categories : []) as CategoryOption[]
  const active = categories.filter((category) => category.lifecycleStatus === "active")
  if (active.length === 0) return Response.json({ ranked: [] })

  const criteria: Record<string, string> = {}
  for (const category of active) {
    const criterion = CATEGORY_CRITERIA[category.name]
    criteria[category.slug] = criterion ? `${category.name}: ${criterion}` : category.name
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/ai/run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("CLOUDFLARE_AI_TOKEN")}`,
        "Content-Type": "application/json",
        "cf-aig-gateway-id": GATEWAY_ID,
        "cf-aig-collect-log": "false",
      },
      body: JSON.stringify({
        model: "typesafe/jev",
        input: {
          state: { text },
          questions: {
            category: {
              type: "choice",
              instructions:
                "The person typed a short phrase while picking a personal-finance category for a bank transaction. Choose the category the phrase most likely means.",
              criteria,
            },
          },
        },
      }),
      signal: request.signal,
    },
  )
  if (!response.ok) return Response.json({ error: `Jev HTTP ${response.status}` }, { status: 502 })

  const { probabilities } = categoryAnswer(await response.json())
  const idBySlug = new Map(active.map((category) => [category.slug, category.id]))
  const ranked = Object.entries(probabilities)
    .flatMap(([slug, probability]) => {
      const id = idBySlug.get(slug)
      return id ? [{ id, probability }] : []
    })
    .sort((first, second) => second.probability - first.probability)
  return Response.json({ ranked })
}
