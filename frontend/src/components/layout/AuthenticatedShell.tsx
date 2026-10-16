import { auditAccess } from "@/features/audit/access.server";
import { accessibleOrganizations } from "@/features/organizations/access.server";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountProfile } from "@/features/auth/types/profile";
import UserMenu from "./UserMenu";
import styles from "./AuthenticatedShell.module.css";

export default async function AuthenticatedShell({
  profile,
  active,
  children,
}: {
  profile: AccountProfile;
  active: "home" | "organizations" | "settings" | "audit";
  children: ReactNode;
}) {
  const master = profile.accountType === "master";
  const organizations = master ? [] : await accessibleOrganizations();
  const hasOrganizations = master || organizations.length === 1;
  const hasAdministration =
    organizations.length === 1 &&
    organizations.some((org) => org.role === "ORGANIZATION_ADMIN");
  const hasAudit = master || hasAdministration || !!(await auditAccess());
  const home = master ? "/admin" : "/";
  const section =
    active === "home"
      ? "Início"
      : active === "organizations"
        ? "Organização"
        : active === "audit"
          ? "Auditoria"
          : "Configurações da conta";
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main-content">
        Ir para o conteúdo
      </a>
      <aside className={styles.sidebar} aria-label="Barra lateral">
        <a
          className={styles.brand}
          href={home}
          aria-label="Application Foundation — Início"
        >
          Application Foundation
        </a>
        <p className={styles.sectionLabel}>Plataforma</p>
        <nav className={styles.navigation} aria-label="Navegação principal">
          <a href={home} aria-current={active === "home" ? "page" : undefined}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m3 10 9-7 9 7v10H3Z" />
              <path d="M9 20v-7h6v7" />
            </svg>
            Início
          </a>
          {hasOrganizations && (
            <Link
              href={
                master
                  ? "/admin/organizations"
                  : organizations.length === 1
                    ? `/organizations/${organizations[0].id}`
                    : "/organizations"
              }
              aria-current={active === "organizations" ? "page" : undefined}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="5" y="3" width="14" height="18" rx="1" />
                <path d="M9 7h2m2 0h2M9 11h2m2 0h2M10 21v-6h4v6" />
              </svg>
              Organização
            </Link>
          )}
          {hasAudit && (
            <Link
              href={master ? "/admin/audit" : "/audit"}
              aria-current={active === "audit" ? "page" : undefined}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="5" y="3" width="14" height="18" rx="2" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
              Auditoria
            </Link>
          )}
        </nav>
        <UserMenu profile={profile} settingsActive={active === "settings"} />
      </aside>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <nav className={styles.breadcrumb} aria-label="Localização">
          <ol>
            <li>
              <a href={home}>Application Foundation</a>
            </li>
            <li>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{section}</span>
            </li>
          </ol>
        </nav>
        {children}
      </main>
    </div>
  );
}
