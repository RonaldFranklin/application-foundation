"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { platformRequest } from "./api";
import styles from "./PlatformAdmins.module.css";
export default function ActivateAdmin() {
  const token = useRef("");
  const pending = useRef(false);
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) token.current = value;
    window.history.replaceState(null, "", window.location.pathname);
    const timer = setTimeout(() => {
      setReady(true);
      setHasToken(!!token.current);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await platformRequest("platform-admin-invitations/accept", {
        token: token.current,
        username: data.get("username"),
        password: data.get("password"),
        confirmPassword: data.get("confirmPassword"),
      });
      token.current = "";
      setAccepted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ativar.");
    } finally {
      form.reset();
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className={styles.activation}>
      <h1>Ativar acesso administrativo</h1>
      {accepted ? (
        <>
          <p role="status">
            Conta ativada. Entre e configure o autenticador para concluir o
            acesso.
          </p>
          <a href="/admin/login">Ir ao login administrativo</a>
        </>
      ) : !ready ? (
        <p role="status">Carregando convite…</p>
      ) : !hasToken ? (
        <p role="alert">Abra o link recebido por e-mail para continuar.</p>
      ) : (
        <form onSubmit={submit}>
          <p>
            Defina sua senha. O MFA será obrigatório antes de acessar as funções
            administrativas.
          </p>
          <label>
            Nome de usuário
            <input
              name="username"
              required
              maxLength={100}
              autoComplete="username"
              disabled={busy}
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              required
              minLength={15}
              maxLength={1024}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <label>
            Confirmar senha
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={15}
              maxLength={1024}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy}>{busy ? "Ativando…" : "Ativar conta"}</button>
        </form>
      )}
    </main>
  );
}
