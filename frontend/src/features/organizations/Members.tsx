"use client";
import { useEffect, useRef, useState } from "react";
import {
  allPermissions,
  type MemberPage,
  type OrganizationPermission,
  organizationsApi,
  OrganizationRequestError,
  organizationRoleLabels,
  type OrganizationMember,
  type OrganizationRole,
} from "./api";
import ResetMfaDialog from "../auth/components/ResetMfaDialog";
import InvitationDialog from "../invitations/InvitationDialog";
import Invitations from "../invitations/Invitations";
import ActionMenu from "./ActionMenu";
import styles from "./Organizations.module.css";
function RoleOptions({ allowAdmin = true }: { allowAdmin?: boolean }) {
  return Object.entries(organizationRoleLabels)
    .filter(([value]) => allowAdmin || value === "MEMBER")
    .map(([value, label]) => (
      <option key={value} value={value}>
        {label}
      </option>
    ));
}
export default function Members({
  organizationId,
  master = true,
  permissions = allPermissions,
  currentUserId,
}: {
  organizationId: string;
  master?: boolean;
  permissions?: readonly OrganizationPermission[];
  currentUserId?: string;
}) {
  const [resetTarget, setResetTarget] = useState<OrganizationMember | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRevision, setInviteRevision] = useState(0);
  const [inviteCount, setInviteCount] = useState<number | null>(null);
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const canInvite =
    permissions.includes("members.create") &&
    permissions.includes("members.link");
  const [tab, setTab] = useState("members");
  const [invitationBusy, setInvitationBusy] = useState(false);
  const canRead = permissions.includes("members.read");
  const [search, setSearch] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<OrganizationMember[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<{
    member: OrganizationMember;
    action: "role" | "remove" | "restore";
  } | null>(null);
  const [role, setRole] = useState<OrganizationRole>("MEMBER");
  const mutating = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/${encodeURIComponent(organizationId)}/members`;
  useEffect(() => {
    if (!canRead || tab !== "members") return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const data = await organizationsApi<MemberPage>(
            `${path}?${new URLSearchParams({ search, deleted: String(deleted), page: String(page), pageSize: String(pageSize), ...(filterRole ? { role: filterRole } : {}) })}`,
            undefined,
            controller.signal,
            master,
          );
          if (!controller.signal.aborted) {
            setItems(data.items);
            setTotal(data.total);
            if (page > 1 && !data.items.length)
              setPage(Math.max(1, Math.ceil(data.total / pageSize)));
          }
        } catch (e) {
          if (!controller.signal.aborted)
            setError(
              e instanceof OrganizationRequestError
                ? e.message
                : "Não foi possível carregar os usuários.",
            );
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
  }, [
    path,
    tab,
    revision,
    search,
    filterRole,
    deleted,
    page,
    pageSize,
    master,
    canRead,
  ]);
  function close(focusHeading = false) {
    setSelected(null);
    requestAnimationFrame(() => {
      if (!focusHeading && trigger.current?.isConnected)
        trigger.current.focus();
      else heading.current?.focus();
    });
  }
  async function mutate(suffix: string, body: object, message: string) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await organizationsApi(path + suffix, body, undefined, master);
      close(true);
      setNotice(message);
      setLoading(true);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof OrganizationRequestError
          ? e.message
          : "Não foi possível salvar.",
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  const editing = selected !== null;
  return (
    <section
      id="members"
      className={`${styles.members} ${styles.userPanel}`}
      aria-labelledby="members-heading"
    >
      {resetTarget && (
        <ResetMfaDialog
          userId={resetTarget.userId}
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
      <header className={styles.header}>
        <div>
          <h2 id="members-heading" ref={heading} tabIndex={-1}>
            Usuários da organização
          </h2>
          <p>
            {canRead && !loading && !error
              ? `${total} ${deleted ? "vínculos removidos" : search || filterRole ? "membros encontrados" : total === 1 ? "membro" : "membros"}`
              : "Os papéis valem somente nesta organização."}
            {inviteCount !== null &&
              ` · ${inviteCount} ${inviteCount === 1 ? "convite pendente" : "convites pendentes"}`}
          </p>
        </div>
        {canInvite && (
          <button
            ref={inviteTrigger}
            className={styles.primary}
            disabled={busy || invitationBusy}
            onClick={() => setInviteOpen(true)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <circle cx="9" cy="7" r="3" />
              <path d="M3 20v-2a6 6 0 0 1 12 0v2M19 7v6m-3-3h6" />
            </svg>
            Convidar usuário
          </button>
        )}
      </header>
      {inviteOpen && (
        <InvitationDialog
          organizationId={organizationId}
          master={master}
          allowAdmin={permissions.includes("members.roles")}
          onClose={() => {
            setInviteOpen(false);
            requestAnimationFrame(() => inviteTrigger.current?.focus());
          }}
          onSent={() => {
            setInviteOpen(false);
            setInviteCount(null);
            setInviteRevision((n) => n + 1);
            setTab("invitations");
          }}
        />
      )}

      <div
        className={`${styles.tabs} ${styles.subtabs}`}
        role="tablist"
        aria-label="Usuários da organização"
      >
        {[
          ["members", "Membros"],
          ["invitations", "Convites"],
        ].map(([value, label], index) => (
          <button
            key={value}
            id={`users-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`users-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            disabled={busy || invitationBusy}
            onClick={() => {
              if (tab !== value) setInviteRevision(0);
              setTab(value);
              if (value === "members" && tab !== value) setLoading(true);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 1
                    : ["ArrowLeft", "ArrowRight"].includes(event.key)
                      ? 1 - index
                      : null;
              if (next === null) return;
              event.preventDefault();
              const value = next === 0 ? "members" : "invitations";
              if (tab !== value) setInviteRevision(0);
              setTab(value);
              if (value === "members" && tab !== value) setLoading(true);
              document.getElementById(`users-tab-${value}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="users-panel-invitations"
        role="tabpanel"
        aria-labelledby="users-tab-invitations"
        hidden={tab !== "invitations"}
        tabIndex={0}
      >
        {tab === "invitations" && (
          <Invitations
            key={inviteRevision}
            sent={inviteRevision > 0}
            onCountChange={setInviteCount}
            organizationId={organizationId}
            master={master}
            permissions={permissions}
            onBusyChange={setInvitationBusy}
          />
        )}
      </div>
      <div
        id="users-panel-members"
        role="tabpanel"
        aria-labelledby="users-tab-members"
        hidden={tab !== "members"}
        tabIndex={0}
      >
        {tab === "members" && (
          <>
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
            {error && (
              <div id="members-error" className={styles.error} role="alert">
                <p>{error}</p>
                {!editing && (
                  <button
                    disabled={busy}
                    onClick={() => setRevision((n) => n + 1)}
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
            {selected && (
              <form
                className={styles.editor}
                aria-describedby={error ? "members-error" : undefined}
                aria-label={
                  selected.action === "role"
                    ? "Alterar papel"
                    : selected.action === "restore"
                      ? "Restaurar vínculo"
                      : "Remover vínculo"
                }
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(
                    `/${selected.member.userId}${selected.action === "role" ? "" : `/${selected.action}`}`,
                    selected.action === "role" ? { role } : {},
                    selected.action === "remove"
                      ? "Vínculo removido desta organização."
                      : selected.action === "restore"
                        ? "Vínculo restaurado com o papel anterior."
                        : "Papel atualizado.",
                  );
                }}
              >
                <h3>
                  {selected.action === "role"
                    ? "Alterar papel"
                    : selected.action === "restore"
                      ? "Restaurar vínculo"
                      : "Remover vínculo"}
                  : {selected.member.username}
                </h3>
                {selected.action === "role" ? (
                  <label>
                    Papel na organização
                    <select
                      autoFocus
                      value={role}
                      onChange={(e) =>
                        setRole(e.target.value as OrganizationRole)
                      }
                      disabled={busy}
                    >
                      <RoleOptions
                        allowAdmin={permissions.includes("members.roles")}
                      />
                    </select>
                  </label>
                ) : (
                  <p>
                    {selected.action === "restore"
                      ? `O vínculo será restaurado como ${organizationRoleLabels[selected.member.role]}.`
                      : "A conta e os vínculos com outras organizações serão mantidos. O Master poderá restaurar este vínculo."}
                  </p>
                )}
                <div className={styles.actions}>
                  <button
                    autoFocus={selected.action !== "role"}
                    disabled={busy}
                  >
                    {busy
                      ? "Salvando…"
                      : selected.action === "remove"
                        ? "Confirmar remoção"
                        : selected.action === "restore"
                          ? "Confirmar restauração"
                          : "Salvar papel"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => close()}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            {canRead && (
              <div className={styles.toolbar}>
                <label className={styles.memberSearch}>
                  <span className={styles.searchCaption} aria-hidden="true">
                    Membro
                  </span>
                  <span className={styles.srOnly}>Buscar usuários</span>
                  <input
                    type="search"
                    value={search}
                    maxLength={254}
                    placeholder="Usuário ou e-mail"
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                      setLoading(true);
                    }}
                  />
                </label>
                <label className={styles.roleFilter}>
                  <span className={styles.srOnly}>Filtrar por cargo</span>
                  <select
                    value={filterRole}
                    onChange={(e) => {
                      setFilterRole(e.target.value);
                      setPage(1);
                      setLoading(true);
                    }}
                  >
                    <option value="">Todos os cargos</option>
                    <RoleOptions />
                  </select>
                </label>
                {master && (
                  <label className={styles.viewFilter}>
                    <span className={styles.srOnly}>
                      Visualização de vínculos
                    </span>
                    <select
                      value={String(deleted)}
                      disabled={editing || busy}
                      onChange={(e) => {
                        setDeleted(e.target.value === "true");
                        setPage(1);
                        setLoading(true);
                      }}
                    >
                      <option value="false">Vínculos atuais</option>
                      <option value="true">Vínculos removidos</option>
                    </select>
                  </label>
                )}
                <button
                  className={styles.clearFilters}
                  disabled={
                    busy || editing || (!search && !filterRole && !deleted)
                  }
                  onClick={() => {
                    setSearch("");
                    setFilterRole("");
                    setDeleted(false);
                    setPage(1);
                    setLoading(true);
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            )}
            {!canRead ? (
              <p className={styles.empty}>
                Você não tem permissão para consultar a lista de usuários.
              </p>
            ) : loading ? (
              <p className={styles.empty} role="status">
                Carregando usuários…
              </p>
            ) : !error && items.length ? (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Usuários vinculados"
              >
                <table className={styles.memberTable}>
                  <thead>
                    <tr>
                      <th>Membro</th>
                      <th>Cargo</th>
                      <th>Organização</th>
                      <th>Status</th>
                      <th>Autenticação</th>
                      <th>Último acesso</th>
                      <th className={styles.actionCell}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((member) => (
                      <tr key={member.userId}>
                        <th scope="row">
                          <div className={styles.memberIdentity}>
                            <span
                              className={styles.memberAvatar}
                              aria-hidden="true"
                            >
                              {member.username
                                .trim()
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) => Array.from(part)[0] || "")
                                .join("")
                                .toUpperCase()}
                            </span>
                            <div>
                              <span className={styles.memberName}>
                                {member.username}
                              </span>
                              <span className={styles.memberEmail}>
                                {member.email}
                              </span>
                              {!master &&
                                member.userId === currentUserId &&
                                member.role === "ORGANIZATION_ADMIN" && (
                                  <span className={styles.memberProtection}>
                                    Seu acesso administrativo é protegido.
                                  </span>
                                )}
                            </div>
                          </div>
                        </th>
                        <td>
                          <span
                            className={`${styles.roleBadge} ${member.role === "ORGANIZATION_ADMIN" ? styles.adminBadge : ""}`}
                          >
                            {organizationRoleLabels[member.role]}
                          </span>
                        </td>
                        <td>
                          <span className={styles.roleBadge}>
                            {member.organization.name}
                          </span>
                        </td>
                        <td>
                          <span className={styles.roleBadge}>
                            {member.deletedAt
                              ? "Vínculo removido"
                              : "Vínculo ativo"}
                          </span>
                        </td>
                        <td>
                          <div className={styles.authBadges}>
                            <span className={styles.roleBadge}>Senha</span>
                            <span className={styles.roleBadge}>
                              {member.mfa.verified
                                ? "TOTP verificado"
                                : member.mfa.configured
                                  ? "TOTP não confirmado"
                                  : "TOTP não configurado"}
                            </span>
                          </div>
                        </td>
                        <td>
                          {member.lastLoginAt ? (
                            <time dateTime={member.lastLoginAt}>
                              {new Date(member.lastLoginAt).toLocaleString(
                                "pt-BR",
                              )}
                            </time>
                          ) : (
                            "Nunca acessou"
                          )}
                        </td>
                        <td className={styles.actionCell}>
                          {!master &&
                          member.userId === currentUserId &&
                          member.role === "ORGANIZATION_ADMIN" ? (
                            <span aria-hidden="true">—</span>
                          ) : permissions.includes("members.roles") ||
                            permissions.includes("members.remove") ? (
                            <ActionMenu
                              label={`Ações de ${member.username}`}
                              icon="more"
                              disabled={editing || busy}
                            >
                              {(button) => (
                                <>
                                  {master && (
                                    <button
                                      onClick={() => {
                                        trigger.current = button;
                                        setResetTarget(member);
                                        setNotice("");
                                      }}
                                    >
                                      Redefinir autenticação de dois fatores
                                    </button>
                                  )}
                                  {(member.deletedAt
                                    ? (["restore"] as const)
                                    : (["role", "remove"] as const)
                                  )
                                    .filter((action) =>
                                      action === "restore"
                                        ? master
                                        : permissions.includes(
                                            action === "role"
                                              ? "members.roles"
                                              : "members.remove",
                                          ),
                                    )
                                    .map((action) => (
                                      <button
                                        key={action}
                                        aria-label={`${action === "role" ? "Alterar papel de" : action === "restore" ? "Restaurar vínculo de" : "Remover vínculo de"} ${member.username}`}
                                        onClick={() => {
                                          trigger.current = button;
                                          setSelected({ member, action });
                                          setRole(member.role);
                                          setError("");
                                          setNotice("");
                                        }}
                                      >
                                        {action === "role"
                                          ? "Alterar papel"
                                          : action === "restore"
                                            ? "Restaurar vínculo"
                                            : "Remover vínculo"}
                                      </button>
                                    ))}
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
              !error && (
                <p className={styles.empty}>
                  {search || filterRole
                    ? "Nenhum usuário encontrado para os filtros."
                    : "Nenhum usuário vinculado à organização."}
                </p>
              )
            )}
            {canRead && (
              <footer className={styles.footer}>
                <label>
                  Itens por página
                  <select
                    value={pageSize}
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
                <nav
                  className={styles.actions}
                  aria-label="Paginação de usuários"
                >
                  <span>
                    {total ? (page - 1) * pageSize + 1 : 0}–
                    {Math.min(page * pageSize, total)} de {total}
                  </span>
                  <button
                    aria-label="Anterior"
                    disabled={loading || page === 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                      setLoading(true);
                    }}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <span
                    className={styles.pageNumber}
                    aria-label={`Página ${page} de ${Math.max(1, Math.ceil(total / pageSize))}`}
                  >
                    {page}
                  </span>
                  <button
                    aria-label="Próxima"
                    disabled={loading || page * pageSize >= total}
                    onClick={() => {
                      setPage((p) => p + 1);
                      setLoading(true);
                    }}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </nav>
              </footer>
            )}
          </>
        )}
      </div>
    </section>
  );
}
