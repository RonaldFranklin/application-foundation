"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountProfile } from "../types/profile";
import { authRequest, AuthRequestError } from "../services/auth-api";
import styles from "./Profile.module.css";

export default function ProfileEditor({
  profile,
}: {
  profile: AccountProfile;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"profile" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  function edit(next: typeof mode) {
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
      setSuccess("Informações atualizadas.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof AuthRequestError
          ? cause.message
          : "Não foi possível salvar. Tente novamente.",
      );
      if (cause instanceof AuthRequestError) setFields(cause.fields);
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
    <div className={styles.editor}>
      {success && <p role="status">{success}</p>}
      {!mode ? (
        <div className={styles.actions}>
          <button type="button" onClick={() => edit("profile")}>
            Editar informações
          </button>
          <button type="button" onClick={() => edit("password")}>
            Alterar senha
          </button>
        </div>
      ) : (
        <form
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
                {field("username", "Usuário", "text", profile.username)}
                {field("email", "E-mail", "email", profile.email)}
                <p className={styles.hint}>
                  O novo e-mail passa a valer imediatamente. Esta versão não
                  verifica a posse do endereço.
                </p>
              </>
            ) : (
              <>
                {field("newPassword", "Nova senha", "password")}
                {field("confirmPassword", "Confirmar nova senha", "password")}
                <p className={styles.hint}>
                  Use de 15 a 1024 caracteres. Todas as sessões serão encerradas
                  e será necessário entrar novamente.
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
  );
}
