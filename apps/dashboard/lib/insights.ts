/** Drop query strings, hashes, and id path segments before an insight event leaves the browser. */
export function redactInsightUrl(value: string): string | null {
  if (!value) return null
  try {
    const absolute = /^https?:\/\//i.test(value)
    const url = new URL(value, "https://household.local")
    url.search = ""
    url.hash = ""
    url.pathname = url.pathname.replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/[id]",
    )
    return absolute ? url.toString() : url.pathname
  } catch {
    return null
  }
}
