import type { JevChoice } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unwrapJevPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new Error("JEV response was not an object");
  }
  const top = isRecord(payload.result) ? payload.result : payload;
  if (isRecord(top.result) && isRecord(top.result.answers)) return top.result;
  if (isRecord(top.answers)) return top;
  throw new Error("JEV response missing answers");
}

export function parseJevChoice(payload: unknown, questionKey: string): JevChoice {
  const body = unwrapJevPayload(payload);
  const answers = body.answers;
  if (!isRecord(answers)) throw new Error("JEV answers missing");
  const answer = answers[questionKey];
  if (!isRecord(answer)) throw new Error(`JEV answer missing: ${questionKey}`);
  if (answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new Error(`JEV answer ${questionKey} was not a choice`);
  }
  const probabilities: Record<string, number> = {};
  if (isRecord(answer.probabilities)) {
    for (const [key, value] of Object.entries(answer.probabilities)) {
      const n = asNumber(value);
      if (n === null) throw new Error(`JEV probability for ${key} was not a number`);
      probabilities[key] = n;
    }
  }
  const confidence = asNumber(answer.confidence);
  if (confidence === null) throw new Error("JEV choice missing confidence");
  const usage = isRecord(body.usage) ? body.usage : {};
  return {
    choice: answer.choice,
    confidence,
    probabilities,
    model: typeof body.model === "string" ? body.model : null,
    usage: {
      inputTokens: asNumber(usage.input_tokens) ?? 0,
      outputTokens: asNumber(usage.output_tokens) ?? 0,
    },
  };
}
