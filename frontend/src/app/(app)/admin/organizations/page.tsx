import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Organizations from "@/features/organizations/Organizations";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(true);
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <Organizations />
    </AuthenticatedShell>
  );
}
