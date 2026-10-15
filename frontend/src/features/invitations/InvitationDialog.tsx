"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { invitationApi } from "./api";
import styles from "../organizations/Organizations.module.css";

export default function InvitationDialog({
  organizationId,
  master,
  allowAdmin,
  onClose,
  onSent,
}: {
  organizationId: string;
  master: boolean;
  allowAdmin: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await invitationApi(
        `/${master ? "admin/" : ""}organizations/${encodeURIComponent(organizationId)}/invitations`,
        { email: data.get("email"), role: data.get("role") },
      );
      dialog.current?.close();
      onSent();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.invitationDialog}
      aria-labelledby="invite-title"
      aria-describedby="invite-description"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "input:not(:disabled), select:not(:disabled), button:not(:disabled)",
          ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className={styles.editor}
        aria-describedby={error ? "invitation-error" : undefined}
      >
        <h2 id="invite-title">Convidar usuário</h2>
        <p id="invite-description">
          O destinatário receberá um link válido por sete dias. Nenhuma conta ou
          associação será criada antes da aceitação.
        </p>
        <label>
          E-mail do convite
          <input
            name="email"
            type="email"
            maxLength={254}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Papel do convite
          <select name="role" defaultValue="MEMBER" disabled={busy}>
            <option value="MEMBER">Membro</option>
            {allowAdmin && (
              <option value="ORGANIZATION_ADMIN">
                Administrador da organização
              </option>
            )}
          </select>
        </label>
        {error && (
          <p id="invitation-error" role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy}>
            {busy ? "Enviando…" : "Enviar convite"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
