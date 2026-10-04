import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Organizations from "@/features/organizations/Organizations";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireWelcome(true);
  const { id } = await params;
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <Organizations id={id} />
    </AuthenticatedShell>
  );
}
