import { redirect } from "next/navigation";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Organizations from "@/features/organizations/Organizations";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(true);
  if (
    profile.accountType !== "master" &&
    !profile.platformPermissions?.some(
      (p) => p === "organizations.read" || p === "organizations.create",
    )
  )
    redirect("/admin");
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <Organizations
        platformPermissions={
          profile.accountType === "master"
            ? undefined
            : (profile.platformPermissions ?? [])
        }
      />
    </AuthenticatedShell>
  );
}
