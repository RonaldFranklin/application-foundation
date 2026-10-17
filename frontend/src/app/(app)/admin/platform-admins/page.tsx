import { redirect } from "next/navigation";
import { requireWelcome } from "@/features/auth/services/welcome.server";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import PlatformSection from "@/features/platform-admin/PlatformSection";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(true);
  if (profile.accountType !== "master") redirect("/admin");
  return (
    <AuthenticatedShell profile={profile} active="platform-admins">
      <PlatformSection />
    </AuthenticatedShell>
  );
}
