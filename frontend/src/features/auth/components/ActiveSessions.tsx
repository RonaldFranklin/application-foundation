"use client";
import { useEffect, useRef, useState } from "react";
import { authRequest } from "../services/auth-api";
import styles from "./Profile.module.css";

type Session = {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  status: "authenticated" | "pending";
};
function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
export default function ActiveSessions({
  administrative,
}: {
  administrative: boolean;
}) {
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Session | "others" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    authRequest<{ items: Session[] }>(
      "auth/sessions",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível consultar as sessões.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  function refresh() {
    setError("");
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function ask(next: Session | "others", button: HTMLButtonElement) {
    trigger.current = button;
    setTarget(next);
  }
  function close() {
    setTarget(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function row(session: Session) {
    return (
      <li key={session.id} className={styles.sessionRow}>
        <div>
          <div className={styles.labelLine}>
            <strong>{session.current ? "Sessão atual" : "Outra sessão"}</strong>
            <span
              className={session.current ? styles.verifiedBadge : styles.badge}
            >
              {session.current
                ? "Este acesso"
                : session.status === "pending"
                  ? "Autenticação pendente"
                  : "Autenticada"}
            </span>
          </div>
          <dl className={styles.sessionDates}>
            <div>
              <dt>Criada em</dt>
              <dd>
                <time dateTime={session.createdAt}>
                  {date(session.createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Expira em</dt>
              <dd>
                <time dateTime={session.expiresAt}>
                  {date(session.expiresAt)}
                </time>
              </dd>
            </div>
          </dl>
        </div>
        <button
          disabled={loading || !!error}
          onClick={(e) => ask(session, e.currentTarget)}
          aria-label={
            session.current
              ? "Encerrar sessão atual"
              : `Encerrar sessão criada em ${date(session.createdAt)}`
          }
        >
          Encerrar sessão
        </button>
      </li>
    );
  }
  return (
    <section
      className={styles.panel}
      aria-labelledby="sessions-title"
      aria-busy={loading}
    >
      <header className={styles.panelHeader}>
        <div>
          <h2 ref={heading} tabIndex={-1} id="sessions-title">
            Sessões ativas
          </h2>
          <p>Acompanhe e encerre os acessos à sua conta.</p>
        </div>
        <button onClick={refresh} disabled={loading}>
          Atualizar
        </button>
      </header>
      <div className={styles.sessionContent}>
        {loading && <p role="status">Carregando sessões…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button onClick={refresh}>Tentar novamente</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {!loading && !error && (
          <>
            {items.length === 0 ? (
              <p>Nenhuma sessão ativa encontrada.</p>
            ) : (
              <>
                <h3>Seu acesso atual</h3>
                {items.some((s) => s.current) ? (
                  <ul className={styles.sessionList}>
                    {items.filter((s) => s.current).map(row)}
                  </ul>
                ) : (
                  <p>
                    A sessão atual não está mais disponível. Entre novamente.
                  </p>
                )}
                <h3>Outras sessões</h3>
                {items.some((s) => !s.current) ? (
                  <ul className={styles.sessionList}>
                    {items.filter((s) => !s.current).map(row)}
                  </ul>
                ) : (
                  <p>Nenhuma outra sessão ativa.</p>
                )}
              </>
            )}
          </>
        )}
        <p className={styles.hint}>
          As datas são exibidas no horário deste navegador. Não há dados de
          dispositivo ou de último acesso disponíveis.
        </p>
        {administrative && (
          <p className={styles.hint}>
            Encerrar sessões mantém o reconhecimento dos dispositivos; cada novo
            acesso continua seguindo sua política de autenticação. Para esquecer
            este navegador, use “Sair e esquecer este dispositivo” no menu da
            conta.
          </p>
        )}
      </div>
      <footer className={styles.panelFooter}>
        <span className={styles.hint}>
          Mantenha apenas os acessos que você utiliza.
        </span>
        <button
          disabled={loading || !!error || !items.some((s) => !s.current)}
          onClick={(e) => ask("others", e.currentTarget)}
        >
          Encerrar outras sessões
        </button>
      </footer>
      {target && (
        <RevokeDialog
          target={target}
          administrative={administrative}
          onClose={close}
          onSuccess={() => {
            setItems((current) =>
              current.filter((s) =>
                target === "others" ? s.current : s.id !== target.id,
              ),
            );
            setTarget(null);
            setNotice(
              target === "others"
                ? "Outras sessões encerradas. Sua sessão atual foi mantida."
                : "Sessão encerrada.",
            );
            refresh();
            requestAnimationFrame(() => heading.current?.focus());
          }}
        />
      )}
    </section>
  );
}
function RevokeDialog({
  target,
  administrative,
  onClose,
  onSuccess,
}: {
  target: Session | "others";
  administrative: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="end-session-title"
      aria-describedby="end-session-effect"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}
    >
      <form
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            const result = await authRequest<{ endedCurrent: boolean }>(
              `auth/sessions/${target === "others" ? "others" : encodeURIComponent(target.id)}/revoke`,
              {},
            );
            if (result.endedCurrent) {
              window.location.replace(
                administrative ? "/admin/login" : "/login",
              );
              return;
            }
            onSuccess();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Não foi possível encerrar a sessão.",
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 id="end-session-title">
          {target === "others"
            ? "Encerrar outras sessões?"
            : target.current
              ? "Encerrar sessão atual?"
              : "Encerrar esta sessão?"}
        </h2>
        <p id="end-session-effect">
          {target === "others"
            ? "Todos os outros acessos serão encerrados. Este acesso continuará ativo."
            : target.current
              ? "Este acesso será encerrado e você será encaminhado ao login."
              : `O acesso criado em ${date(target.createdAt)} será encerrado. Sua sessão atual continuará ativa.`}
        </p>
        <p>
          Será necessário entrar novamente para retomar os acessos encerrados.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" autoFocus disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Encerrando…" : "Confirmar encerramento"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
