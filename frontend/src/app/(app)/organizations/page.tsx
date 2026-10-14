import Link from "next/link";
import { redirect } from "next/navigation";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import { requireWelcome } from "@/features/auth/services/welcome.server";
import OrganizationState from "@/features/organizations/OrganizationState";
import { organizationDirectory } from "@/features/organizations/access.server";
import styles from "@/features/organizations/Organizations.module.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(false);
  const accessible = await organizationDirectory();
  const administered =
    accessible?.filter((org) => org.role === "ORGANIZATION_ADMIN") ?? [];
  if (administered.length === 1)
    redirect(`/organizations/${administered[0].id}`);
  const organizations = administered.length ? administered : accessible;
  if (!organizations?.length)
    return (
      <AuthenticatedShell profile={profile} active="organizations">
        <OrganizationState unavailable={organizations === null} />
      </AuthenticatedShell>
    );
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>Organizações</h1>
          <p>Escolha uma organização autorizada para continuar.</p>
        </header>
        <div className={styles.overview}>
          <ul>
            {organizations.map((org) => (
              <li key={org.id}>
                <Link href={`/organizations/${org.id}`}>{org.name}</Link> —{" "}
                {org.active ? "Ativa" : "Inativa"}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </AuthenticatedShell>
  );
}
