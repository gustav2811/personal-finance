export async function readLocal<T>(scope: string): Promise<T> {
  const response = await fetch(`/api/dashboard?scope=${scope}`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error("Local dashboard data bridge is unavailable.")
  }
  return (await response.json()) as T
}

export function isLocalPreview(): boolean {
  return process.env.NODE_ENV !== "production"
}
