import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sessionCookieName } from "@/lib/public-config";
import type { OrganizationAccess } from "./api";

// null means denied; undefined means unavailable. Neither permits rendering protected data.
async function read<T>(path: string): Promise<T | null | undefined> {
  const name = sessionCookieName(
    process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001",
  );
  const cookie = (await cookies()).get(name);
  if (!cookie) return null;
  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_ORIGIN || "http://localhost:3001"}/v1/organizations${path}`,
      { headers: { Cookie: `${name}=${cookie.value}` }, cache: "no-store" },
    );
    if ([401, 403, 404].includes(response.status)) return null;
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}
// React cache deduplicates only within the server render; no cross-request authorization cache.
export const organizationDirectory = cache(
  async (): Promise<OrganizationAccess[] | null> => {
    const result = await read<{ items: OrganizationAccess[] }>("");
    return result === undefined ? null : (result?.items ?? []);
  },
);
export async function accessibleOrganizations(): Promise<OrganizationAccess[]> {
  return (await organizationDirectory()) ?? [];
}
export async function requireOrganization(
  id: string,
  tab?: string,
): Promise<OrganizationAccess | null | undefined> {
  const access = await read<OrganizationAccess>(
    `/${encodeURIComponent(id)}/access`,
  );
  if (!access) return access;
  if (
    tab === "users" &&
    !access.permissions.some((p) => p.startsWith("members."))
  )
    return null;
  if (
    tab === "permissions" &&
    !access.permissions.includes("permissions.manage")
  )
    return null;
  if (
    tab === "overview" &&
    !access.permissions.includes("organization.read") &&
    !access.permissions.includes("organization.update")
  )
    return null;
  return access;
}
