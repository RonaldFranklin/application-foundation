"use client";
import { useEffect, useRef, useState } from "react";
import { authRequest } from "../services/auth-api";
import styles from "./ResetMfaDialog.module.css";
export default function ResetCredentialsDialog({
  kind = "mfa",
  master = true,
  requiresMfa = true,
  userId,
  username,
  onClose,
  onSuccess,
}: {
  kind?: "mfa" | "password";
  master?: boolean;
  requiresMfa?: boolean;
  userId: string;
  username: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="reset-mfa-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          if (
            kind === "password" &&
            data.get("temporaryPassword") !== data.get("confirmPassword")
          ) {
            setError("A confirmação deve coincidir com a senha temporária.");
            form.reset();
            return;
          }
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await authRequest(
              `${master ? "admin/" : ""}accounts/${encodeURIComponent(userId)}/${kind}/reset`,
              {
                currentPassword: data.get("currentPassword"),
                ...(requiresMfa ? { code: data.get("code") } : {}),
                ...(kind === "password"
                  ? {
                      temporaryPassword: data.get("temporaryPassword"),
                      confirmPassword: data.get("confirmPassword"),
                    }
                  : {}),
              },
            );
            form.reset();
            onSuccess();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Não foi possível redefinir a autenticação.",
            );
          } finally {
            form.reset();
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 id="reset-mfa-title">
          {kind === "password"
            ? "Redefinir senha"
            : "Redefinir autenticação de dois fatores"}
        </h2>
        <p>
          Conta: <strong>{username}</strong>. Todas as sessões e dispositivos
          reconhecidos serão revogados.
        </p>
        {kind === "password" ? (
          <>
            <p>
              Defina uma senha temporária exclusiva para esta conta e
              compartilhe-a com o usuário por um canal apropriado. Ela não será
              exibida após concluir. O usuário deverá escolher uma senha nova
              antes de acessar o sistema.
            </p>
            <label>
              Senha temporária
              <input
                name="temporaryPassword"
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={1024}
                required
                disabled={busy}
              />
            </label>
            <label>
              Confirmar senha temporária
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={1024}
                required
                disabled={busy}
              />
            </label>
          </>
        ) : (
          <p>
            O autenticador e os códigos de recuperação serão removidos. O
            usuário precisará configurar MFA novamente quando a política ou o
            fluxo exigir. Atualmente, poderá ativá-lo voluntariamente nas
            configurações da conta.
          </p>
        )}
        <label>
          Sua senha atual
          <input
            autoFocus
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            disabled={busy}
          />
        </label>
        {requiresMfa && (
          <>
            <label>
              Código do seu autenticador
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={busy}
                aria-describedby="reset-mfa-hint"
              />
            </label>
            <p id="reset-mfa-hint">
              Use um código novo, ainda não utilizado nesta sessão.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button disabled={busy}>
            {busy ? "Redefinindo…" : "Confirmar redefinição"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
