export async function callServiceRoleRpc<T>(
  url: string,
  serviceKey: string,
  name: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`supabase ${name} ${await errorMessage(response)}`);
  }
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string };
    return body.message?.slice(0, 180) ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
