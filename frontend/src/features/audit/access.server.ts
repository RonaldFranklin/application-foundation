import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sessionCookieName } from "@/lib/public-config";
// Request-local memoization only; membership and session context remain server-owned.
export const auditAccess = cache(
  async (): Promise<{ organization: string } | null | undefined> => {
    const name = sessionCookieName(
      process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001",
    );
    const cookie = (await cookies()).get(name);
    if (!cookie) return null;
    try {
      const response = await fetch(
        `${process.env.API_INTERNAL_ORIGIN || "http://localhost:3001"}/v1/audit/access`,
        {
          headers: { Cookie: `${name}=${cookie.value}` },
          cache: "no-store",
        },
      );
      if ([401, 403].includes(response.status)) return null;
      return response.ok ? await response.json() : undefined;
    } catch {
      return undefined;
    }
  },
);
