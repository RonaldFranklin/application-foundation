import "server-only";
import type { AccountProfile } from "../types/profile";
import { sessionCookieName } from "@/lib/public-config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export async function requireWelcome(master: boolean) {
  const jar = await cookies();
  const name = sessionCookieName(
    process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001",
  );
  const cookie = jar.get(name);
  if (!cookie) redirect(master ? "/admin/login" : "/login");
  let data: AccountProfile | null = null;
  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_ORIGIN || "http://localhost:3001"}/v1/${master ? "admin/" : ""}welcome`,
      { headers: { Cookie: `${name}=${cookie.value}` }, cache: "no-store" },
    );
    if (response.ok) data = await response.json();
  } catch {}
  if (!data) redirect(master ? "/admin/login" : "/login");
  return data;
}
