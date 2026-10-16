import Link from "next/link";
import { redirect } from "next/navigation";
import { organizationDirectory } from "@/features/organizations/access.server";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Audit from "@/features/audit/Audit";
import { auditAccess } from "@/features/audit/access.server";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(false);
  const access = await auditAccess();
  if (
    access === null &&
    (await organizationDirectory())?.some(
      (org) => org.role === "ORGANIZATION_ADMIN",
    )
  )
    redirect("/organizations");
  return (
    <AuthenticatedShell profile={profile} active="audit">
      {access ? (
        <Audit master={false} organization={access.organization} />
      ) : (
        <section>
          <h1>Auditoria indisponível</h1>
          <p role="alert">
            {access === undefined
              ? "Não foi possível verificar o acesso. Tente novamente."
              : "Selecione uma organização ativa que você administra. Seu vínculo ou acesso pode ter sido revogado."}
          </p>
          {access === undefined ? (
            <a href="/audit">Tentar novamente</a>
          ) : (
            <Link href="/organizations">Selecionar organização</Link>
          )}
        </section>
      )}
    </AuthenticatedShell>
  );
}
