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
  );
  if (response.status === 401) {
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (!response.ok && path.includes("/members")) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : "Não foi possível concluir a solicitação.",
    );
  }
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Organização não encontrada."
        : response.status === 400
          ? "Revise os dados informados. Use um nome de 1 a 200 caracteres."
          : "Não foi possível concluir a solicitação. Tente novamente.",
    );
  return response.json();
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
