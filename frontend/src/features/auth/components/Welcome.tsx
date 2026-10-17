import EnableMfa from "./EnableMfa";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import ProfileEditor from "./ProfileEditor";
import Link from "next/link";
import ActiveSessions from "./ActiveSessions";
import { requireWelcome } from "../services/welcome.server";
import styles from "./Profile.module.css";

export default async function Welcome({
  master = false,
  tab = "profile",
}: {
  master?: boolean;
  tab?: "profile" | "sessions";
}) {
  const profile = await requireWelcome(master);
  const base = master ? "/admin/settings" : "/settings";
  return (
    <AuthenticatedShell profile={profile} active="settings">
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>Configurações da conta</h1>
            <p>Gerencie as informações e a segurança da sua conta.</p>
          </header>
          <div className={styles.layout}>
            <nav
              className={styles.navigation}
              aria-label="Configurações da conta"
            >
              <Link
                href={base}
                aria-current={tab === "profile" ? "page" : undefined}
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
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
                </svg>
                Perfil
              </Link>
              <Link
                href={`${base}?tab=sessions`}
                aria-current={tab === "sessions" ? "page" : undefined}
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
                  <rect x="3" y="4" width="18" height="13" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
                Sessões
              </Link>
            </nav>
            <div className={styles.content}>
              {tab === "sessions" ? (
                <ActiveSessions
                  administrative={profile.accountType !== "common"}
                />
              ) : (
                <section
                  className={styles.panel}
                  id="profile-details"
                  aria-labelledby="profile-title"
                >
                  <div className={styles.panelHeader}>
                    <div>
                      <h2 id="profile-title">Dados do perfil</h2>
                      <p>Informações da sua conta Application Foundation.</p>
                    </div>
                  </div>
                  <ProfileEditor profile={profile}>
                    <dl className={styles.readonlyDetails}>
                      <div className={styles.row}>
                        <dt>
                          <span>Tipo de conta</span>
                          <span className={styles.hint}>
                            Categoria da sua conta.
                          </span>
                        </dt>
                        <dd>
                          <span className={styles.badge}>
                            {profile.accountType === "master"
                              ? "Master"
                              : profile.accountType === "platform-admin"
                                ? "Administrador da plataforma"
                                : "Comum"}
                          </span>
                        </dd>
                      </div>
                      <div className={styles.row}>
                        <dt>
                          <span>Autenticação multifator (MFA)</span>
                          <span className={styles.hint}>
                            Proteção adicional de acesso.
                          </span>
                        </dt>
                        <dd className={styles.mfa}>
                          <span>
                            Configurado:{" "}
                            {profile.mfa.configured ? "Sim" : "Não"}
                          </span>
                          <span
                            className={
                              profile.mfa.verified
                                ? styles.verified
                                : styles.muted
                            }
                          >
                            Verificado: {profile.mfa.verified ? "Sim" : "Não"}
                          </span>
                          {!profile.mfa.verified &&
                            profile.accountType !== "master" && (
                              <EnableMfa
                                administrative={
                                  profile.accountType === "platform-admin"
                                }
                              />
                            )}
                        </dd>
                      </div>
                    </dl>
                  </ProfileEditor>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthenticatedShell>
  );
}
