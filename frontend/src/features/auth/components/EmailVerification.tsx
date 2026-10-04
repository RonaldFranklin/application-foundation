"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  verificationRequest,
  VerificationRequestError,
} from "../services/email-verification";
import styles from "./EmailVerification.module.css";
export default function EmailVerification({
  email,
  emailVerifiedAt,
}: {
  email: string;
  emailVerifiedAt: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(!!emailVerifiedAt);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!deadline) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  function cooldown(seconds: number) {
    setRemaining(seconds);
    setDeadline(Date.now() + seconds * 1000);
  }
  function close() {
    dialog.current?.close();
    opener.current?.focus();
  }
  function showError(e: unknown) {
    setError(
      e instanceof VerificationRequestError
        ? e.message
        : "Verificação temporariamente indisponível.",
    );
    if (e instanceof VerificationRequestError && e.retryAfter)
      cooldown(e.retryAfter);
  }
  async function request() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await verificationRequest("request");
      cooldown(result.retryAfter ?? 60);
      setRequested(true);
      setCode("");
      setNotice("Código solicitado. Aguarde a mensagem no seu e-mail.");
      dialog.current?.showModal();
      setOpen(true);
    } catch (e) {
      showError(e);
      // An existing challenge can still be confirmed after navigation/reload.
      if (e instanceof VerificationRequestError && e.retryAfter > 0) {
        setRequested(true);
        dialog.current?.showModal();
        setOpen(true);
      }
    } finally {
      setPending(false);
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await verificationRequest("confirm", code);
      if (!result.emailVerifiedAt) throw new Error();
      close();
      setVerified(true);
      setNotice("E-mail verificado com sucesso.");
      router.refresh();
    } catch (e) {
      showError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      id="email-verification"
      className={styles.section}
      aria-label="Verificação do e-mail"
    >
      <p className={styles.state} role="status">
        {verified ? "✓ E-mail verificado" : "E-mail não verificado"}
      </p>
      {!verified && (
        <>
          <p>
            Confirme a titularidade de {email}. Você pode continuar usando sua
            conta normalmente.
          </p>
          <button
            ref={opener}
            type="button"
            disabled={pending || (!requested && remaining > 0)}
            onClick={() => {
              if (requested) {
                setError("");
                dialog.current?.showModal();
                setOpen(true);
              } else void request();
            }}
          >
            {pending ? "Solicitando código…" : "Verificar e-mail"}
          </button>
          {!requested && remaining > 0 && (
            <p>Aguarde {remaining}s para solicitar outro código.</p>
          )}
        </>
      )}
      <div aria-live="polite">{notice && <p role="status">{notice}</p>}</div>
      {!open && error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="verification-title"
        aria-describedby="verification-description"
        onClose={() => {
          setOpen(false);
          opener.current?.focus();
        }}
      >
        <h2 id="verification-title">Verificar e-mail</h2>
        <p id="verification-description">
          Digite o código enviado para <strong>{email}</strong>. Ele vale por 10
          minutos após a solicitação.
        </p>
        <form onSubmit={confirm}>
          <label htmlFor="verification-code">Código de seis dígitos</label>
          <input
            id="verification-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-describedby={error ? "verification-error" : undefined}
          />
          {error && (
            <p id="verification-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <div className={styles.actions}>
            <button type="button" onClick={close}>
              Cancelar
            </button>
            <button type="submit" disabled={pending || code.length !== 6}>
              {pending ? "Aguarde…" : "Confirmar código"}
            </button>
          </div>
        </form>
        <button
          type="button"
          disabled={pending || remaining > 0}
          onClick={() => void request()}
        >
          {remaining > 0
            ? `Reenviar código em ${remaining}s`
            : "Reenviar código"}
        </button>
      </dialog>
    </section>
  );
}
