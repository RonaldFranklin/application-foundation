import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName } from "@/lib/public-config";
import type { OrganizationAccess } from "./api";
async function read(path: string) {
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
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
export async function accessibleOrganizations(): Promise<OrganizationAccess[]> {
  return (await read(""))?.items ?? [];
}
export async function requireOrganization(
  id: string,
  tab?: string,
): Promise<OrganizationAccess> {
  const access: OrganizationAccess | null = await read(
    `/${encodeURIComponent(id)}/access`,
  );
  if (!access) redirect("/");
  if (
    tab === "users" &&
    !access.permissions.some((p) => p.startsWith("members."))
  )
    redirect("/");
  if (
    tab === "permissions" &&
    !access.permissions.includes("permissions.manage")
  )
    redirect("/");
  if (
    tab === "overview" &&
    !access.permissions.includes("organization.read") &&
    !access.permissions.includes("organization.update")
  )
    redirect("/");
  return access;
}
