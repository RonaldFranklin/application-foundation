import Link from "next/link";
import { redirect } from "next/navigation";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import { requireWelcome } from "@/features/auth/services/welcome.server";
import { accessibleOrganizations } from "@/features/organizations/access.server";
import styles from "@/features/organizations/Organizations.module.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  const profile = await requireWelcome(false);
  const organizations = await accessibleOrganizations();
  if (!organizations.length) redirect("/");
  return (
    <AuthenticatedShell profile={profile} active="organizations">
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>Organizações</h1>
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
