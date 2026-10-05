"use client";
import EmailVerification from "./EmailVerification";
import { useRef, useState, useLayoutEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AccountProfile } from "../types/profile";
import { authRequest, AuthRequestError } from "../services/auth-api";
import styles from "./Profile.module.css";

export default function ProfileEditor({
  profile,
  children,
}: {
  profile: AccountProfile;
  children: ReactNode;
}) {
  const router = useRouter();
  const [source, setSource] = useState(profile);
  const [persisted, setPersisted] = useState(profile);
  const [draft, setDraft] = useState({
    username: profile.username,
    email: profile.email,
  });
  const [syncError, setSyncError] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  if (source !== profile) {
    setSource(profile);
    setPersisted(profile);
    setDraft({ username: profile.username, email: profile.email });
  }
  async function reconcile() {
    try {
      const current = await authRequest<AccountProfile>(
        profile.accountType === "master" ? "admin/welcome" : "welcome",
      );
      setPersisted(current);
      setDraft({ username: current.username, email: current.email });
      setSyncError(false);
      return true;
    } catch {
      setSyncError(true);
      setMode(null);
      setDraft({ username: persisted.username, email: persisted.email });
      return false;
    }
  }
  const [mode, setMode] = useState<"profile" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const emailChanged = mode === "profile" && draft.email !== persisted.email;
  const previousMode = useRef(mode);
  useLayoutEffect(() => {
    if (busy) return;
    if (mode === "profile" && previousMode.current !== mode)
      usernameInput.current?.focus();
    if (mode === null && previousMode.current !== null)
      editButton.current?.focus();
    previousMode.current = mode;
  }, [mode, busy]);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  function edit(next: typeof mode) {
    setDraft({ username: persisted.username, email: persisted.email });
    setMode(next);
    setError("");
    setFields({});
    setSuccess("");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setError("");
    setFields({});
    setSuccess("");
    if (mode === "password" && values.newPassword !== values.confirmPassword) {
      setFields({
        confirmPassword: "A confirmação deve coincidir com a nova senha.",
      });
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      await authRequest(
        mode === "password" ? "auth/password" : "auth/profile",
        values,
      );
      form.reset();
      if (mode === "password") {
        // Full navigation discards authenticated client state and the router cache.
        window.location.replace(
          profile.accountType === "master" ? "/admin/login" : "/login",
        );
        return;
      }
      setMode(null);
      if (await reconcile()) setSuccess("Informações atualizadas.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof AuthRequestError
          ? cause.message
          : "Não foi possível salvar. Tente novamente.",
      );
      if (cause instanceof AuthRequestError) setFields(cause.fields);
      if (mode === "profile") {
        await reconcile();
        router.refresh();
      }
      for (const name of [
        "currentPassword",
        "code",
        "newPassword",
        "confirmPassword",
      ]) {
        const input = form.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = "";
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function field(name: string, label: string, type = "text", value?: string) {
    return (
      <div className={styles.field}>
        <label htmlFor={`edit-${name}`}>{label}</label>
        <input
          id={`edit-${name}`}
          name={name}
          type={type}
          defaultValue={value}
          required
          maxLength={
            name === "username"
              ? 100
              : name === "email"
                ? 254
                : name === "code"
                  ? 6
                  : 1024
          }
          minLength={name === "newPassword" ? 15 : undefined}
          autoComplete={
            name === "currentPassword"
              ? "current-password"
              : type === "password"
                ? "new-password"
                : name === "code"
                  ? "one-time-code"
                  : name
          }
          inputMode={name === "code" ? "numeric" : undefined}
          pattern={name === "code" ? "[0-9]{6}" : undefined}
          aria-invalid={!!fields[name]}
          aria-describedby={fields[name] ? `error-${name}` : undefined}
        />
        {fields[name] && (
          <p id={`error-${name}`} role="alert">
            {fields[name]}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      <div className={styles.details}>
        {(["username", "email"] as const).map((name) => (
          <div className={styles.row} key={name}>
            <div>
              <div className={styles.labelLine}>
                <label htmlFor={`edit-${name}`}>
                  {name === "username" ? "Usuário" : "E-mail"}
                </label>
                {name === "email" && (
                  <span
                    className={`${styles.verificationBadge} ${persisted.emailVerifiedAt && !emailChanged ? styles.verifiedBadge : ""}`}
                    role="status"
                  >
                    {emailChanged
                      ? "Alteração não salva"
                      : persisted.emailVerifiedAt
                        ? "✓ Verificado"
                        : "Não verificado"}
                  </span>
                )}
              </div>
              <span className={styles.hint}>
                {name === "username"
                  ? "Seu nome de usuário."
                  : "E-mail associado à conta."}
              </span>
            </div>
            <div className={styles.inlineField}>
              <input
                ref={name === "username" ? usernameInput : undefined}
                id={`edit-${name}`}
                name={name}
                type={name === "email" ? "email" : "text"}
                autoComplete={name}
                form={mode === "profile" ? "profile-edit" : undefined}
                readOnly={mode !== "profile" || busy}
                required
                maxLength={name === "username" ? 100 : 254}
                value={mode === "profile" ? draft[name] : persisted[name]}
                onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
                aria-invalid={!!fields[name]}
                aria-describedby={fields[name] ? `error-${name}` : undefined}
              />
              {fields[name] && (
                <p id={`error-${name}`} role="alert">
                  {fields[name]}
                </p>
              )}
              {name === "email" && (
                <EmailVerification
                  compact
                  disabled={mode !== null || busy || syncError}
                  key={persisted.email + (persisted.emailVerifiedAt ?? "")}
                  email={persisted.email}
                  emailVerifiedAt={persisted.emailVerifiedAt}
                  onVerified={(timestamp) =>
                    setPersisted({ ...persisted, emailVerifiedAt: timestamp })
                  }
                />
              )}
            </div>
          </div>
        ))}
        {children}
      </div>
      <div className={styles.editor}>
        {syncError && (
          <div role="alert">
            Não foi possível atualizar os dados. Os valores exibidos são os
            últimos confirmados; consulte a API antes de editar novamente.
            <button type="button" onClick={() => void reconcile()}>
              Atualizar dados
            </button>
          </div>
        )}
        {success && <p role="status">{success}</p>}
        {!mode ? (
          <div className={styles.actions}>
            <button
              ref={editButton}
              type="button"
              disabled={syncError || busy}
              onClick={() => edit("profile")}
            >
              Editar informações
            </button>
            <button
              type="button"
              disabled={busy || syncError}
              onClick={() => edit("password")}
            >
              Alterar senha
            </button>
          </div>
        ) : (
          <form
            id="profile-edit"
            onSubmit={save}
            key={mode}
            aria-busy={busy}
            aria-describedby={error ? "profile-error" : undefined}
          >
            <fieldset disabled={busy}>
              <legend>
                {mode === "profile" ? "Editar informações" : "Alterar senha"}
              </legend>
              {mode === "profile" ? (
                <>
                  <p className={styles.hint}>
                    Confirme sua identidade para salvar. Um novo e-mail
                    precisará ser verificado novamente.
                  </p>
                </>
              ) : (
                <>
                  {field("newPassword", "Nova senha", "password")}
                  {field("confirmPassword", "Confirmar nova senha", "password")}
                  <p className={styles.hint}>
                    Use de 15 a 1024 caracteres. Todas as sessões serão
                    encerradas e será necessário entrar novamente.
                  </p>
                </>
              )}
              {field("currentPassword", "Senha atual", "password")}
              {profile.accountType === "master" && (
                <>
                  {field("code", "Código do autenticador")}
                  <p className={styles.hint}>
                    Use um código novo. Aguarde o próximo código se já usou o
                    atual; códigos de recuperação não são aceitos aqui.
                  </p>
                </>
              )}
              {error && (
                <p id="profile-error" role="alert">
                  {error}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit">
                  {busy ? "Salvando…" : "Salvar alterações"}
                </button>
                <button type="button" onClick={() => edit(null)}>
                  Cancelar
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </>
  );
}
