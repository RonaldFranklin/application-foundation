"use client";
import { useEffect, useRef, useState } from "react";
import { authRequest } from "../services/auth-api";
import styles from "./ResetMfaDialog.module.css";
export default function ResetMfaDialog({
  userId,
  username,
  onClose,
  onSuccess,
}: {
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
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await authRequest(
              `admin/accounts/${encodeURIComponent(userId)}/mfa/reset`,
              {
                currentPassword: data.get("currentPassword"),
                code: data.get("code"),
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
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 id="reset-mfa-title">Redefinir autenticação de dois fatores</h2>
        <p>
          Conta: <strong>{username}</strong>. O autenticador e os códigos de
          recuperação serão removidos. Todas as sessões e dispositivos
          reconhecidos serão revogados.
        </p>
        <p>
          Administradores da plataforma precisarão configurar e confirmar um
          novo autenticador antes de acessar a administração.
        </p>
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
