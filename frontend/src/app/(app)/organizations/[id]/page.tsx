import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Organizations from "@/features/organizations/Organizations";
import { requireWelcome } from "@/features/auth/services/welcome.server";
import { requireOrganization } from "@/features/organizations/access.server";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await requireWelcome(false);
  const { id } = await params;
  const { tab } = await searchParams;
  const access = await requireOrganization(id, tab);
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <Organizations id={id} master={false} permissions={access.permissions} />
    </AuthenticatedShell>
  );
}
