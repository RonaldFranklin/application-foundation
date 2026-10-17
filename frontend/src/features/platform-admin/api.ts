export async function platformRequest<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001"}/v1/${path}`,
    {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Não foi possível concluir a operação.");
  return data;
}
