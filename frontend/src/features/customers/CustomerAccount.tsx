"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  customerRequest,
  CustomerProfile,
  CustomerRequestError,
  CustomerSession,
} from "./api";
import styles from "./Customers.module.css";
export default function CustomerAccount() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null),
    [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState(""),
    [codes, setCodes] = useState<string[]>([]);
  const saving = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const [p, s] = await Promise.all([
        customerRequest<CustomerProfile>("/account", undefined, false, signal),
        customerRequest<{ items: CustomerSession[] }>(
          "/sessions",
          undefined,
          false,
          signal,
        ),
      ]);
      setProfile(p);
      setSessions(s.items);
    } catch (e) {
      if (signal?.aborted) return;
      setProfile(null);
      setSessions([]);
      if (e instanceof CustomerRequestError && e.status === 401)
        window.location.replace("/customer/login");
      else setError("Não foi possível carregar a conta. Tente novamente.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void refresh(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [refresh]);
  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (data: Record<string, FormDataEntryValue>) => Promise<void>,
  ) {
    event.preventDefault();
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    void run(async () => {
      await action(data);
      form.reset();
    });
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span>Application Foundation · Clientes</span>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await customerRequest("/logout", {});
              window.location.assign(
                new URL("/customer/login", window.location.origin).href,
              );
            })
          }
        >
          Sair
        </button>
      </header>
      <h1>Minha conta</h1>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Carregando conta…</p>
      ) : !profile ? (
        <button onClick={() => refresh()}>Tentar novamente</button>
      ) : (
        <>
          <section className={styles.card}>
            <h2>Dados da conta</h2>
            <dl>
              <dt>E-mail verificado</dt>
              <dd>{profile.email}</dd>
            </dl>
            <form
              onSubmit={(e) =>
                submit(e, async (data) => {
                  setProfile(await customerRequest("/account", data));
                  setNotice("Nome atualizado.");
                })
              }
            >
              <label>
                Nome de exibição
                <input
                  name="name"
                  defaultValue={profile.name ?? ""}
                  required
                  maxLength={100}
                />
              </label>
              <button disabled={busy}>Salvar nome</button>
            </form>
          </section>
          <section className={styles.card}>
            <h2>Segurança</h2>
            <p>
              MFA {profile.mfaEnabled ? "ativado" : "desativado"}. A
              configuração é opcional.
            </p>
            {codes.length ? (
              <div>
                <p>
                  Guarde estes códigos agora. Cada um funciona uma única vez e
                  não poderá ser exibido novamente.
                </p>
                <ul className={styles.codes}>
                  {codes.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
                <button onClick={() => setCodes([])}>Guardei os códigos</button>
              </div>
            ) : secret ? (
              <>
                <p>
                  Adicione esta chave ao autenticador:{" "}
                  <code className={styles.codes}>{secret}</code>
                </p>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      const r = await customerRequest<{
                        recoveryCodes: string[];
                      }>("/mfa/enroll", data);
                      setCodes(r.recoveryCodes);
                      setSecret("");
                      await refresh();
                    })
                  }
                >
                  <label>
                    Código do novo autenticador
                    <input
                      name="code"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                    />
                  </label>
                  <button disabled={busy}>Confirmar MFA</button>
                </form>
              </>
            ) : (
              <form
                onSubmit={(e) =>
                  submit(e, async (data) => {
                    const r = await customerRequest<{ secret: string }>(
                      "/mfa/setup",
                      data,
                    );
                    setSecret(r.secret);
                  })
                }
              >
                <label>
                  Senha atual
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={1024}
                    required
                  />
                </label>
                {profile.mfaEnabled && (
                  <label>
                    Fator atual (autenticador ou recuperação)
                    <input
                      name="code"
                      autoComplete="one-time-code"
                      maxLength={64}
                      required
                    />
                  </label>
                )}
                <button disabled={busy}>
                  {profile.mfaEnabled
                    ? "Substituir autenticador e códigos"
                    : "Configurar MFA"}
                </button>
              </form>
            )}
            {profile.mfaEnabled && !secret && !codes.length && (
              <details>
                <summary>Desativar MFA</summary>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      await customerRequest("/mfa/disable", data);
                      await refresh();
                      setNotice("MFA desativado.");
                    })
                  }
                >
                  <label>
                    Senha atual
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      required
                    />
                  </label>
                  <label>
                    Fator atual
                    <input
                      name="code"
                      autoComplete="one-time-code"
                      maxLength={64}
                      required
                    />
                  </label>
                  <button disabled={busy}>Confirmar desativação</button>
                </form>
              </details>
            )}
            <p>
              Sem autenticador e sem códigos de recuperação, não há redefinição
              administrativa de MFA.
            </p>
          </section>
          <section className={styles.card}>
            <h2>Sessões ativas</h2>
            <div className={styles.actions}>
              <button disabled={busy} onClick={() => refresh()}>
                Atualizar
              </button>
              <button
                disabled={busy || sessions.length < 2}
                onClick={() => {
                  if (window.confirm("Encerrar todas as outras sessões?"))
                    void run(async () => {
                      await customerRequest("/sessions/revoke", {
                        others: true,
                      });
                      await refresh();
                    });
                }}
              >
                Encerrar outras sessões
              </button>
            </div>
            {!sessions.length ? (
              <p>Nenhuma sessão ativa.</p>
            ) : (
              <ul>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <p>
                      {s.current
                        ? "Sessão atual"
                        : s.stage === "full"
                          ? "Outra sessão"
                          : "MFA pendente"}{" "}
                      · Criada em{" "}
                      {new Date(s.createdAt).toLocaleString("pt-BR")} · Expira
                      em {new Date(s.expiresAt).toLocaleString("pt-BR")}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Encerrar esta sessão?"))
                          void run(async () => {
                            await customerRequest("/sessions/revoke", {
                              id: s.id,
                            });
                            if (s.current)
                              window.location.assign(
                                new URL(
                                  "/customer/login",
                                  window.location.origin,
                                ).href,
                              );
                            else await refresh();
                          });
                      }}
                    >
                      Encerrar {s.current ? "sessão atual" : "sessão"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
