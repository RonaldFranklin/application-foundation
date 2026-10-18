const API = process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001";
export class CustomerRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function customerRequest<T>(
  path: string,
  body?: object,
  administrative = false,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${API}/v1/${administrative ? "organization-customers" : "customer"}${path}`,
    {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CustomerRequestError(
      response.status,
      response.status === 429
        ? "Tente novamente mais tarde."
        : result.message || "Não foi possível concluir.",
    );
  return result;
}
export interface CustomerProfile {
  id: string;
  name: string | null;
  email: string;
  status: string;
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
}
export interface CustomerSession {
  id: string;
  current: boolean;
  stage: string;
  createdAt: string;
  expiresAt: string;
}
