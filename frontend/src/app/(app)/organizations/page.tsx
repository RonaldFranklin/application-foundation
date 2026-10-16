import { redirect } from "next/navigation";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import { requireWelcome } from "@/features/auth/services/welcome.server";
import OrganizationState from "@/features/organizations/OrganizationState";
import { organizationDirectory } from "@/features/organizations/access.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(false);
  const organizations = await organizationDirectory();
  if (organizations?.length === 1)
    redirect(`/organizations/${organizations[0].id}`);
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <OrganizationState unavailable={organizations === null} />
    </AuthenticatedShell>
  );
}
