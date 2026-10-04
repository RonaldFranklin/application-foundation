import EmailVerification from "./EmailVerification";
import AuthenticatedShell from "@/components/layout/AuthenticatedShell";
import ProfileEditor from "./ProfileEditor";
import Logout from "./Logout";
import { requireWelcome } from "../services/welcome.server";
import styles from "./Profile.module.css";

export default async function Welcome({
  master = false,
}: {
  master?: boolean;
}) {
  const profile = await requireWelcome(master);
  return (
    <AuthenticatedShell profile={profile} active="settings">
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <span className={styles.brand}>Application Foundation</span>
            <h1 lang="en">Account Settings</h1>
            <p>Gerencie as informações e a segurança da sua conta.</p>
          </header>
          <div className={styles.layout}>
            <nav
              className={styles.navigation}
              aria-label="Configurações da conta"
            >
              <a href="#profile-details" aria-current="page" lang="en">
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
                Profile
              </a>
            </nav>
            <div className={styles.content}>
              <section
                className={styles.panel}
                id="profile-details"
                aria-labelledby="profile-title"
              >
                <div className={styles.panelHeader}>
                  <div>
                    <h2 id="profile-title" lang="en">
                      Profile Details
                    </h2>
                    <p>Informações da sua conta Application Foundation.</p>
                  </div>
                </div>
                <dl className={styles.details}>
                  <div className={styles.row}>
                    <dt>
                      <span lang="en">Username</span>
                      <span className={styles.hint}>Seu nome de usuário.</span>
                    </dt>
                    <dd>{profile.username}</dd>
                  </div>
                  <div className={styles.row}>
                    <dt>
                      <span lang="en">Email Address</span>
                      <span className={styles.hint}>
                        E-mail associado à conta.
                      </span>
                    </dt>
                    <dd>{profile.email}</dd>
                  </div>
                  <div className={styles.row}>
                    <dt>
                      <span lang="en">Account Type</span>
                      <span className={styles.hint}>
                        Categoria da sua conta.
                      </span>
                    </dt>
                    <dd>
                      <span className={styles.badge}>
                        {profile.accountType === "master" ? "Master" : "Comum"}
                      </span>
                    </dd>
                  </div>
                  <div className={styles.row}>
                    <dt>
                      <span lang="en">Multi-factor authentication</span>
                      <span className={styles.hint}>
                        Proteção adicional de acesso.
                      </span>
                    </dt>
                    <dd className={styles.mfa}>
                      <span>
                        Configurado: {profile.mfa.configured ? "Sim" : "Não"}
                      </span>
                      <span
                        className={
                          profile.mfa.verified ? styles.verified : styles.muted
                        }
                      >
                        Verificado: {profile.mfa.verified ? "Sim" : "Não"}
                      </span>
                    </dd>
                  </div>
                </dl>
                <EmailVerification
                  key={profile.email + (profile.emailVerifiedAt ?? "")}
                  email={profile.email}
                  emailVerifiedAt={profile.emailVerifiedAt}
                />
                <ProfileEditor profile={profile} />
              </section>
              <section
                className={styles.session}
                aria-labelledby="session-title"
              >
                <div>
                  <h2 id="session-title">Sua sessão</h2>
                  <p>Encerre o acesso ao terminar de usar sua conta.</p>
                </div>
                <div className={styles.logout}>
                  <Logout master={profile.accountType === "master"} />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </AuthenticatedShell>
  );
}
