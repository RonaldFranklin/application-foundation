import { apiError, connectionError } from "@/lib/api-errors";
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
export async function authRequest<T = AuthResult>(
  path: string,
  body?: object,
): Promise<T> {
  const response = await fetch(`${API}/v1/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  }).catch(() => {
    throw new AuthRequestError(connectionError, false);
  });
  const data =
    response.status === 204 ? {} : await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiError(response.status, data, path);
    throw new AuthRequestError(
      error.message,
      error.challengeRequired,
      error.fields,
    );
  }
  if (!data || typeof data !== "object")
    throw new AuthRequestError(apiError(500, null, path).message, false);
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
