"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ResetMfaDialog from "../auth/components/ResetMfaDialog";
import { platformRequest } from "./api";
import styles from "./PlatformAdmins.module.css";
type Row = {
  id: string;
  kind: "account" | "invitation";
  email: string;
  username: string;
  permissions: string[];
  status: string;
  mfa: boolean;
};
type Page = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  catalog: Record<string, string>;
};
const labels: Record<string, string> = {
  all: "Todos",
  active: "Ativo",
  inactive: "Inativo",
  pending: "Convite pendente",
  expired: "Convite expirado",
  revoked: "Convite cancelado",
  accepted: "Convite aceito",
};
export default function PlatformAdmins() {
  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [result, setResult] = useState<Page | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<{
    row?: Row;
    action: "invite" | "edit" | "state" | "resend" | "revoke";
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await platformRequest<Page>(
          `admin/platform-admins?${new URLSearchParams({ search, status, page: String(page) })}`,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setResult(data);
          if (page > 1 && !data.items.length)
            setPage(Math.max(1, Math.ceil(data.total / 10)));
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Não foi possível carregar.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, page, revision]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
  }, [modal]);
  function open(action: NonNullable<typeof modal>["action"], row?: Row) {
    trigger.current = document.activeElement as HTMLElement;
    setError("");
    setModal({ action, row });
  }
  function close() {
    if (busy) return;
    dialog.current?.close();
    setModal(null);
    trigger.current?.focus();
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || pending.current) return;
    pending.current = true;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const row = modal.row;
      const perms = form.getAll("permissions");
      if (modal.action === "invite")
        await platformRequest("admin/platform-admins/invitations", {
          email: form.get("email"),
          permissions: perms,
        });
      else if (modal.action === "edit" || modal.action === "state")
        await platformRequest(`admin/platform-admins/${row!.id}`, {
          active:
            modal.action === "state"
              ? row!.status !== "active"
              : row!.status === "active",
          permissions: modal.action === "edit" ? perms : row!.permissions,
        });
      else
        await platformRequest(
          `admin/platform-admins/invitations/${row!.id}/${modal.action}`,
          {},
        );
      dialog.current?.close();
      setModal(null);
      trigger.current?.focus();
      setNotice(
        modal.action === "invite" || modal.action === "resend"
          ? "Convite enfileirado. A entrega depende do serviço de e-mail."
          : "Alteração salva.",
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Administradores da plataforma
          </h1>
          <p>
            Gerencie contas administrativas, convites e permissões da
            plataforma.
          </p>
        </div>
        <button
          className={styles.primary}
          disabled={!result}
          onClick={() => open("invite")}
        >
          Convidar administrador
        </button>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          Buscar conta ou convite
          <input
            type="search"
            value={search}
            maxLength={254}
            placeholder="Nome de usuário ou e-mail"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className={styles.stateFilter}>
          Estado
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.refresh}
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && !modal && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!loading && result && (
        <p className={styles.summary} aria-live="polite">
          {result.total}{" "}
          {result.total === 1
            ? "conta ou convite encontrado"
            : "contas ou convites encontrados"}
        </p>
      )}
      {loading ? (
        <p className={styles.state} role="status">
          Carregando administradores…
        </p>
      ) : !result?.items.length ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            +
          </span>
          <h2>Nenhuma conta ou convite encontrado.</h2>
          <p>
            Convide uma pessoa e conceda apenas as permissões administrativas
            necessárias.
          </p>
        </div>
      ) : (
        <div
          className={styles.table}
          role="region"
          aria-label="Administradores e convites"
          tabIndex={0}
        >
          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Estado</th>
                <th>Autenticação</th>
                <th>Permissões</th>
                <th className={styles.actionHeading}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <th scope="row">
                    <div className={styles.identity}>
                      <span className={styles.avatar} aria-hidden="true">
                        {(row.username || row.email)
                          .trim()
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <span className={styles.identityText}>
                        {row.username && <strong>{row.username}</strong>}
                        <span>{row.email}</span>
                      </span>
                    </div>
                  </th>
                  <td>
                    <span
                      className={`${styles.badge} ${row.status === "active" || row.status === "accepted" ? styles.positive : row.status === "pending" ? styles.pending : styles.muted}`}
                    >
                      {labels[row.status] ?? row.status}
                    </span>
                  </td>
                  <td>
                    {row.kind === "account" ? (
                      <span
                        className={`${styles.badge} ${row.mfa ? styles.positive : styles.warning}`}
                      >
                        {row.mfa ? "MFA configurado" : "MFA pendente"}
                      </span>
                    ) : (
                      <span className={styles.mutedText}>—</span>
                    )}
                  </td>
                  <td>
                    <div className={styles.permissions}>
                      {row.permissions.length ? (
                        row.permissions.map((p) => (
                          <span className={styles.permission} key={p}>
                            {result.catalog[p] ?? p}
                          </span>
                        ))
                      ) : (
                        <span className={styles.mutedText}>Nenhuma</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {row.kind === "account" ? (
                        <>
                          <button
                            onClick={() => {
                              trigger.current =
                                document.activeElement as HTMLElement;
                              setResetTarget(row);
                            }}
                          >
                            Redefinir autenticação de dois fatores
                          </button>
                          <button onClick={() => open("edit", row)}>
                            Permissões
                          </button>
                          <button onClick={() => open("state", row)}>
                            {row.status === "active"
                              ? "Desativar"
                              : "Restaurar"}
                          </button>
                        </>
                      ) : (
                        <>
                          {["pending", "expired"].includes(row.status) && (
                            <button onClick={() => open("resend", row)}>
                              Reenviar
                            </button>
                          )}
                          {row.status === "pending" && (
                            <button onClick={() => open("revoke", row)}>
                              Cancelar convite
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className={styles.pagination} aria-label="Paginação">
        <button
          disabled={loading || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <span>
          Página {page} de {Math.max(1, Math.ceil((result?.total ?? 0) / 10))}
        </span>
        <button
          disabled={loading || page * 10 >= (result?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </nav>
      {resetTarget && (
        <ResetMfaDialog
          userId={resetTarget.id}
          username={resetTarget.username}
          onClose={() => {
            setResetTarget(null);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
          onSuccess={() => {
            setResetTarget(null);
            setNotice(
              "Autenticação de dois fatores redefinida. Acessos anteriores revogados.",
            );
            setRevision((n) => n + 1);
            requestAnimationFrame(() => heading.current?.focus());
          }}
        />
      )}
      {modal && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="admin-dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <form onSubmit={submit}>
            <h2 id="admin-dialog-title">
              {modal.action === "invite"
                ? "Convidar administrador"
                : modal.action === "edit"
                  ? "Alterar permissões"
                  : "Confirmar ação"}
            </h2>
            {modal.row && <p>{modal.row.email}</p>}
            {modal.action === "invite" && (
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  disabled={busy}
                />
              </label>
            )}
            {["invite", "edit"].includes(modal.action) ? (
              <fieldset disabled={busy}>
                <legend>Permissões explícitas</legend>
                {Object.entries(result?.catalog ?? {}).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      defaultChecked={
                        modal.row?.permissions.includes(key) ?? false
                      }
                    />
                    {label}
                  </label>
                ))}
                <p>
                  Sem concessões, a conta não acessará módulos administrativos.
                  MFA é obrigatório.
                </p>
              </fieldset>
            ) : (
              <p>
                {modal.action === "state"
                  ? modal.row?.status === "active"
                    ? "Desativar o acesso e encerrar todas as sessões desta conta?"
                    : "Restaurar o acesso com as permissões listadas?"
                  : modal.action === "revoke"
                    ? "Cancelar este convite? O link deixará de funcionar."
                    : "Enviar um novo convite? O link anterior deixará de funcionar."}
              </p>
            )}
            {modal.action === "edit" && (
              <p>Salvar encerra todas as sessões desta conta.</p>
            )}
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
              <button type="button" autoFocus disabled={busy} onClick={close}>
                Cancelar
              </button>
              <button disabled={busy}>
                {busy
                  ? "Salvando…"
                  : modal.action === "invite"
                    ? "Enviar convite"
                    : "Confirmar"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
