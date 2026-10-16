import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sessionCookieName } from "@/lib/public-config";
export const organizationContext = cache(
  async (): Promise<
    { organizationId: string; name: string } | null | undefined
  > => {
    const name = sessionCookieName(
      process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001",
    );
    const cookie = (await cookies()).get(name);
    if (!cookie) return null;
    try {
      const response = await fetch(
        `${process.env.API_INTERNAL_ORIGIN || "http://localhost:3001"}/v1/organization-context`,
        { headers: { Cookie: `${name}=${cookie.value}` }, cache: "no-store" },
      );
      if ([401, 403, 409].includes(response.status)) return null;
      return response.ok ? await response.json() : undefined;
    } catch {
      return undefined;
    }
  },
);
