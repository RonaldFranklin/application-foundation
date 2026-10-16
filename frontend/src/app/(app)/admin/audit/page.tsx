import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Audit from "@/features/audit/Audit";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(true);
  return (
    <AuthenticatedShell profile={profile} active="audit">
      <Audit />
    </AuthenticatedShell>
  );
}
