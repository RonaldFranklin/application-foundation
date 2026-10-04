import { apiError, connectionError } from "@/lib/api-errors";
export class OrganizationRequestError extends Error {}
export interface Organization {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationPage {
  items: Organization[];
  total: number;
  page: number;
  pageSize: number;
}
export async function organizationsApi<T>(
  path = "",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001"}/v1/admin/organizations${path}`,
    {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  ).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new OrganizationRequestError(connectionError);
  });
  if (response.status === 401) {
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
    throw new OrganizationRequestError("Sessão expirada. Entre novamente.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new OrganizationRequestError(
      apiError(response.status, data, `admin/organizations${path}`).message,
    );
  }
  return response.json().catch(() => {
    throw new OrganizationRequestError(
      apiError(500, null, "admin/organizations").message,
    );
  });
}

export const organizationRoleLabels = {
  MEMBER: "Membro",
  ORGANIZATION_ADMIN: "Administrador da organização",
} as const;
export type OrganizationRole = keyof typeof organizationRoleLabels;
export interface OrganizationMember {
  userId: string;
  username: string;
  email: string;
  role: OrganizationRole;
  createdAt: string;
}
