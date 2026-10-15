"use client";
import { useEffect, useRef, useState } from "react";
import { invitationApi } from "./api";
import {
  type OrganizationPermission,
  type OrganizationRole,
  organizationRoleLabels,
} from "../organizations/api";
import ActionMenu from "../organizations/ActionMenu";
import styles from "../organizations/Organizations.module.css";
export const invitationStatusLabels = {
  pending: "Pendente",
  expired: "Expirado",
  accepted: "Aceito",
  revoked: "Cancelado",
} as const;
type Status = keyof typeof invitationStatusLabels;
type Item = {
  id: string;
  email: string;
  role: OrganizationRole;
  createdBy: string;
  createdAt: string;
  deliveredAt: string | null;
  expiresAt: string;
  status: Status;
};
type InvitationPage = {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Status | "all", number>;
};
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");
export default function Invitations({
  organizationId,
  master,
  permissions,
  onBusyChange,
  onCountChange,
  sent = false,
}: {
  organizationId: string;
  master: boolean;
  permissions: readonly OrganizationPermission[];
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number | null) => void;
  sent?: boolean;
}) {
  const canWrite =
    permissions.includes("members.create") &&
    permissions.includes("members.link");
  const canRead = permissions.includes("members.read");
  const path = `/${master ? "admin/" : ""}organizations/${encodeURIComponent(organizationId)}/invitations`;
  const [data, setData] = useState<InvitationPage | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    sent
      ? "Convite enfileirado para envio. A participação depende da aceitação do destinatário."
      : "",
  );
  const heading = useRef<HTMLHeadingElement>(null),
    pending = useRef(false);
  useEffect(() => {
    if (sent) heading.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const result = await invitationApi<InvitationPage>(
            `${path}?${new URLSearchParams({ search, status, page: String(page), pageSize: String(pageSize) })}`,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setData(result);
          onCountChange?.(search ? null : result.counts.pending);
          if (page > 1 && !result.items.length)
            setPage(Math.max(1, Math.ceil(result.total / pageSize)));
        } catch (e) {
          if (!controller.signal.aborted) {
            setError((e as Error).message);
            onCountChange?.(null);
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, canRead, revision, onCountChange, search, status, page, pageSize]);
  async function mutate(suffix: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      await invitationApi(path + suffix, {});
      onCountChange?.(null);
      setNotice(
        suffix.endsWith("revoke")
          ? "Convite cancelado."
          : "Convite enfileirado para envio. A participação depende da aceitação do destinatário.",
      );
      setLoading(true);
      setRevision((n) => n + 1);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  if (!canRead && !canWrite) return null;
  return (
    <section
      className={styles.invitationList}
      aria-labelledby="invitations-heading"
    >
      <header className={styles.header}>
        <div>
          <h3 id="invitations-heading" ref={heading} tabIndex={-1}>
            Convites
          </h3>
          {data && !loading && !error && (
            <p>
              {data.total} resultados · {data.counts.pending} pendentes ·{" "}
              {data.counts.expired} expirados
              {search ? " para esta busca" : " na organização"}
            </p>
          )}
        </div>
        {canRead && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          >
            Atualizar convites
          </button>
        )}
      </header>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {canRead && (
        <>
          <div className={styles.toolbar}>
            <label className={styles.memberSearch}>
              <span className={styles.srOnly}>Buscar convites por e-mail</span>
              <input
                type="search"
                placeholder="Buscar convites…"
                value={search}
                maxLength={254}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setLoading(true);
                }}
              />
            </label>
            <label>
              <span className={styles.srOnly}>Status do convite</span>
              <select
                value={status}
                disabled={busy}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                  setLoading(true);
                }}
              >
                <option value="all">Todos os convites</option>
                {Object.entries(invitationStatusLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {loading ? (
            <p role="status">Carregando convites…</p>
          ) : (
            !error &&
            (data?.items.length ? (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Lista de convites"
              >
                <table>
                  <thead>
                    <tr>
                      <th>E-mail do destinatário</th>
                      <th>Papel</th>
                      <th>Convidado por</th>
                      <th>Envio</th>
                      <th>Validade</th>
                      <th>Status</th>
                      <th className={styles.actionCell}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => (
                      <tr key={i.id}>
                        <th scope="row">
                          <span className={styles.inviteeIdentity}>
                            <span
                              className={styles.inviteIcon}
                              aria-hidden="true"
                            >
                              ✉
                            </span>
                            <span>
                              {i.email}
                              <span className={styles.memberEmail}>
                                Emissão {date(i.createdAt)}
                              </span>
                            </span>
                          </span>
                        </th>
                        <td>
                          <span
                            className={`${styles.roleBadge} ${i.role === "ORGANIZATION_ADMIN" ? styles.adminBadge : ""}`}
                          >
                            {organizationRoleLabels[i.role]}
                          </span>
                        </td>
                        <td>{i.createdBy}</td>
                        <td>
                          {i.deliveredAt
                            ? date(i.deliveredAt)
                            : "Aguardando envio"}
                        </td>
                        <td>{date(i.expiresAt)}</td>
                        <td>
                          <span
                            className={styles.invitationStatus}
                            data-status={i.status}
                          >
                            {invitationStatusLabels[i.status]}
                          </span>
                        </td>
                        <td className={styles.actionCell}>
                          {canWrite &&
                          (i.status === "pending" || i.status === "expired") &&
                          (i.role !== "ORGANIZATION_ADMIN" ||
                            permissions.includes("members.roles")) ? (
                            <ActionMenu
                              label={`Ações do convite para ${i.email}`}
                              icon="more"
                              disabled={busy}
                            >
                              {() => (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void mutate(`/${i.id}/resend`)
                                    }
                                  >
                                    Reenviar
                                  </button>
                                  {i.status === "pending" && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void mutate(`/${i.id}/revoke`)
                                      }
                                    >
                                      Cancelar convite
                                    </button>
                                  )}
                                </>
                              )}
                            </ActionMenu>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Nenhum convite encontrado.</p>
            ))
          )}
          <footer className={styles.footer}>
            <label>
              Itens por página
              <select
                value={pageSize}
                disabled={busy}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                  setLoading(true);
                }}
              >
                {[5, 10, 25, 50, 100].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
            <nav className={styles.actions} aria-label="Paginação de convites">
              <span>
                {data?.total ? (page - 1) * pageSize + 1 : 0}–
                {Math.min(page * pageSize, data?.total ?? 0)} de{" "}
                {data?.total ?? 0}
              </span>
              <button
                aria-label="Anterior"
                disabled={loading || busy || page === 1}
                onClick={() => {
                  setPage((p) => p - 1);
                  setLoading(true);
                }}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <span className={styles.pageNumber} aria-label={`Página ${page}`}>
                {page}
              </span>
              <button
                aria-label="Próxima"
                disabled={
                  loading || busy || page * pageSize >= (data?.total ?? 0)
                }
                onClick={() => {
                  setPage((p) => p + 1);
                  setLoading(true);
                }}
              >
                <span aria-hidden="true">›</span>
              </button>
            </nav>
          </footer>
        </>
      )}
    </section>
  );
}
