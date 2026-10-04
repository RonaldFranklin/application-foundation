import type { AuthResult, SessionState } from "../types/auth";
const API = process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001";
export class AuthRequestError extends Error {
  constructor(
    message: string,
    public challengeRequired: boolean,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function authRequest(
  path: string,
  body?: object,
): Promise<AuthResult> {
  const response = await fetch(`${API}/v1/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new AuthRequestError(
      data.message || "Não foi possível continuar. Tente novamente.",
      !!data.challengeRequired,
      data.fields || {},
    );
  }
  return data;
}
export async function readSession(): Promise<SessionState> {
  const response = await fetch(`${API}/v1/auth/session`, {
    credentials: "include",
    cache: "no-store",
  });
  return response.ok ? response.json() : Promise.reject();
}
export async function logout(forgetDevice: boolean) {
  const response = await fetch(`${API}/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forgetDevice }),
  });
  if (!response.ok) throw new Error();
}
