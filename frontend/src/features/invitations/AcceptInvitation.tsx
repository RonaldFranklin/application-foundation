"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { invitationApi } from "./api";
import {
  type OrganizationRole,
  organizationRoleLabels,
} from "../organizations/api";
import styles from "../organizations/Organizations.module.css";
type Preview = {
  organization: string;
  role: OrganizationRole;
  expiresAt: string;
};
export default function AcceptInvitation() {
  const token = useRef(""),
    started = useRef(false),
    pending = useRef(false),
    result = useRef<HTMLParagraphElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [accepted, setAccepted] = useState(false);
  const [mode, setMode] = useState("existing");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current =
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    invitationApi<Preview>("/invitations/preview", { token: token.current })
      .then(setPreview)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget,
      data = new FormData(form);
    if (
      mode === "new" &&
      data.get("password") !== data.get("confirmPassword")
    ) {
      setError("As senhas devem coincidir.");
      requestAnimationFrame(() => result.current?.focus());
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await invitationApi("/invitations/accept", {
        token: token.current,
        mode,
        ...(mode === "new"
          ? {
              username: data.get("username"),
              password: data.get("password"),
              confirmPassword: data.get("confirmPassword"),
            }
          : {}),
      });
      token.current = "";
      setAccepted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      for (const input of form.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      ))
        input.value = "";
      pending.current = false;
      setBusy(false);
      requestAnimationFrame(() => result.current?.focus());
    }
  }
  return (
    <main className={styles.container}>
      <h1>Aceitar convite</h1>
      {loading && <p role="status">Conferindo convite…</p>}
      {error && (
        <p
          ref={result}
          tabIndex={-1}
          role="alert"
          id="accept-error"
          className={styles.error}
        >
          {error}
        </p>
      )}
      {accepted ? (
        <>
          <p ref={result} tabIndex={-1} role="status">
            Convite aceito. Entre pelo login normal para continuar.
          </p>
          <a href="/login">Entrar</a>
        </>
      ) : (
        preview && (
          <>
            <p>
              Participar de <strong>{preview.organization}</strong> como{" "}
              {organizationRoleLabels[preview.role]}.
            </p>
            <p>
              Válido até{" "}
              {new Date(preview.expiresAt).toLocaleDateString("pt-BR")}.
            </p>
            <form
              onSubmit={submit}
              aria-label="Aceitar convite"
              aria-describedby={error ? "accept-error" : undefined}
              className={styles.editor}
            >
              <label>
                Como deseja continuar?
                <select
                  value={mode}
                  disabled={busy}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setError("");
                  }}
                >
                  <option value="existing">Já tenho conta</option>
                  <option value="new">Criar minha conta</option>
                </select>
              </label>
              {mode === "existing" ? (
                <p>
                  <a href="/login" target="_blank" rel="noopener noreferrer">
                    Entrar na conta em outra aba
                  </a>
                  . Use a conta do endereço que recebeu o convite. Depois, volte
                  a esta aba e confirme a aceitação.
                </p>
              ) : (
                <>
                  <label>
                    Usuário
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
                  <p>
                    Use uma senha de 15 a 1024 caracteres. O e-mail será o
                    endereço que recebeu este convite.
                  </p>
                </>
              )}
              <button disabled={busy}>
                {busy ? "Aceitando…" : "Aceitar convite"}
              </button>
            </form>
          </>
        )
      )}
      <p>
        Ao recarregar ou fechar esta página, reabra o link do e-mail para
        continuar.
      </p>
    </main>
  );
}
