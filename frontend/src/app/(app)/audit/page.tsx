import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import Audit from "@/features/audit/Audit";
import { auditAccess } from "@/features/audit/access.server";
import { requireWelcome } from "@/features/auth/services/welcome.server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(false);
  const access = await auditAccess();
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
              : "O acesso exige uma única organização ativa sob sua administração. Se o seu vínculo mudou, entre novamente."}
          </p>
          {access === undefined && <a href="/audit">Tentar novamente</a>}
        </section>
      )}
    </AuthenticatedShell>
  );
}
