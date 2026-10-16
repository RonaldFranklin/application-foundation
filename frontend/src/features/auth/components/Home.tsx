import { redirect } from "next/navigation";
import { organizationDirectory } from "@/features/organizations/access.server";
import OrganizationState from "@/features/organizations/OrganizationState";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import styles from "@/components/layout/AuthenticatedShell.module.css";
import { requireWelcome } from "../services/welcome.server";
export default async function Home({ master = false }: { master?: boolean }) {
  const profile = await requireWelcome(master);
  if (!master) {
    const organizations = await organizationDirectory();
    if (organizations === null)
      return (
        <AuthenticatedShell profile={profile} active="home">
          <OrganizationState unavailable retryHref="/" />
        </AuthenticatedShell>
      );
    if (organizations.length === 1)
      redirect(`/organizations/${organizations[0].id}`);
    return (
      <AuthenticatedShell profile={profile} active="home">
        <OrganizationState />
      </AuthenticatedShell>
    );
  }
  return (
    <AuthenticatedShell profile={profile} active="home">
      <div className={styles.intro}>
        <h1>Boas-vindas ao Application Foundation, {profile.username}.</h1>
        <p>Este é o seu espaço no Application Foundation.</p>
        {profile.accountType === "platform-admin" &&
          !profile.platformPermissions?.length && (
            <p>
              Nenhuma permissão administrativa foi concedida. Solicite ao Master
              o acesso necessário.
            </p>
          )}
        {!profile.emailVerifiedAt && (
          <aside aria-label="Verificação de e-mail">
            <p>
              Seu e-mail ainda não foi verificado. Você pode usar sua conta
              normalmente.
            </p>
            <a
              href={
                master
                  ? "/admin/settings#email-verification"
                  : "/settings#email-verification"
              }
            >
              Verificar e-mail nas configurações
            </a>
          </aside>
        )}
        <section className={styles.empty} aria-labelledby="home-next">
          <h2 id="home-next">Espaço reservado</h2>
          <p>
            Esta área receberá funcionalidades em etapas futuras. Você já pode
            acessar as configurações da sua conta pelo menu de usuário.
          </p>
        </section>
      </div>
    </AuthenticatedShell>
  );
}
