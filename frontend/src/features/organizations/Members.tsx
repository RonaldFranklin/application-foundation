"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
}: {
  organizationId: string;
  master?: boolean;
  permissions?: readonly OrganizationPermission[];
}) {
  const canRead = permissions.includes("members.read");
  const [search, setSearch] = useState("");
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
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  const [selected, setSelected] = useState<{
    member: OrganizationMember;
    action: "role" | "remove";
  } | null>(null);
  const [role, setRole] = useState<OrganizationRole>("MEMBER");
  const [password, setPassword] = useState("");
  const mutating = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/${encodeURIComponent(organizationId)}/members`;
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const data = await organizationsApi<MemberPage>(
            `${path}?${new URLSearchParams({ search, page: String(page), pageSize: String(pageSize), ...(filterRole ? { role: filterRole } : {}) })}`,
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
  }, [path, revision, search, filterRole, page, pageSize, master, canRead]);
  function close(focusHeading = false) {
    setMode(null);
    setSelected(null);
    setPassword("");
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
      setPassword("");
      mutating.current = false;
      setBusy(false);
    }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate(
      "",
      {
        mode,
        email: data.get("email"),
        role,
        ...(mode === "new" ? { username: data.get("username"), password } : {}),
      },
      "Usuário adicionado à organização.",
    );
  }
  const editing = mode !== null || selected !== null;
  return (
    <section id="members" aria-labelledby="members-heading">
      <header className={styles.header}>
        <div>
          <h2 id="members-heading" ref={heading} tabIndex={-1}>
            Usuários da organização
          </h2>
          <p>Os papéis valem somente nesta organização.</p>
        </div>
        {(permissions.includes("members.create") ||
          permissions.includes("members.link")) && (
          <ActionMenu
            label="Adicionar usuário"
            icon="plus"
            disabled={editing || busy}
          >
            {(button) =>
              (["new", "existing"] as const)
                .filter((value) =>
                  permissions.includes(
                    value === "new" ? "members.create" : "members.link",
                  ),
                )
                .map((value) => (
                  <button
                    key={value}
                    onClick={() => {
                      trigger.current = button;
                      setMode(value);
                      setRole("MEMBER");
                      setError("");
                      setNotice("");
                    }}
                  >
                    {value === "new"
                      ? "Cadastrar usuário"
                      : "Vincular conta existente"}
                  </button>
                ))
            }
          </ActionMenu>
        )}
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <div id="members-error" className={styles.error} role="alert">
          <p>{error}</p>
          {!editing && (
            <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {mode && (
        <form
          className={styles.editor}
          aria-describedby={error ? "members-error" : undefined}
          onSubmit={add}
          aria-label={
            mode === "new" ? "Cadastrar usuário" : "Vincular conta existente"
          }
        >
          <h3>
            {mode === "new" ? "Cadastrar usuário" : "Vincular conta existente"}
          </h3>
          {mode === "new" && (
            <label>
              Usuário
              <input
                name="username"
                required
                maxLength={100}
                autoComplete="off"
                autoFocus
                disabled={busy}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              autoFocus={mode === "existing"}
              disabled={busy}
            />
          </label>
          {mode === "new" && (
            <>
              <label>
                Senha temporária
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={15}
                  maxLength={1024}
                  autoComplete="new-password"
                  disabled={busy}
                  aria-describedby="member-password-help"
                />
              </label>
              <p id="member-password-help">
                Use de 15 a 1024 caracteres. Entregue as credenciais à pessoa
                por um canal combinado. A troca de senha será obrigatória no
                primeiro acesso pelo login comum. Não há envio de convite nem
                verificação do e-mail informado.
              </p>
            </>
          )}
          {mode === "existing" && (
            <p>
              Informe o e-mail da conta comum existente. Sua senha e seus demais
              vínculos serão preservados.
            </p>
          )}
          <label>
            Papel na organização
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrganizationRole)}
              disabled={busy}
            >
              <RoleOptions allowAdmin={permissions.includes("members.roles")} />
            </select>
          </label>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy}>
              {busy ? "Salvando…" : "Adicionar usuário"}
            </button>
            <button type="button" disabled={busy} onClick={() => close()}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {selected && (
        <form
          className={styles.editor}
          aria-describedby={error ? "members-error" : undefined}
          aria-label={
            selected.action === "role" ? "Alterar papel" : "Remover vínculo"
          }
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              `/${selected.member.userId}${selected.action === "remove" ? "/remove" : ""}`,
              selected.action === "remove" ? {} : { role },
              selected.action === "remove"
                ? "Vínculo removido desta organização."
                : "Papel atualizado.",
            );
          }}
        >
          <h3>
            {selected.action === "role" ? "Alterar papel" : "Remover vínculo"}:{" "}
            {selected.member.username}
          </h3>
          {selected.action === "role" ? (
            <label>
              Papel na organização
              <select
                autoFocus
                value={role}
                onChange={(e) => setRole(e.target.value as OrganizationRole)}
                disabled={busy}
              >
                <RoleOptions
                  allowAdmin={permissions.includes("members.roles")}
                />
              </select>
            </label>
          ) : (
            <p>A conta e os vínculos com outras organizações serão mantidos.</p>
          )}
          <div className={styles.actions}>
            <button autoFocus={selected.action === "remove"} disabled={busy}>
              {busy
                ? "Salvando…"
                : selected.action === "remove"
                  ? "Confirmar remoção"
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
          <label>
            Buscar usuários
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
          <label>
            Filtrar por cargo
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
      ) : items.length ? (
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Usuários vinculados"
        >
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>E-mail</th>
                <th>Papel na organização</th>
                <th className={styles.actionCell}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <tr key={member.userId}>
                  <th scope="row">{member.username}</th>
                  <td>{member.email}</td>
                  <td>{organizationRoleLabels[member.role]}</td>
                  <td className={styles.actionCell}>
                    {permissions.includes("members.roles") ||
                    permissions.includes("members.remove") ? (
                      <ActionMenu
                        label={`Ações de ${member.username}`}
                        icon="pencil"
                        disabled={editing || busy}
                      >
                        {(button) =>
                          (["role", "remove"] as const)
                            .filter((action) =>
                              permissions.includes(
                                action === "role"
                                  ? "members.roles"
                                  : "members.remove",
                              ),
                            )
                            .map((action) => (
                              <button
                                key={action}
                                aria-label={`${action === "role" ? "Alterar papel de" : "Remover vínculo de"} ${member.username}`}
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
                                  : "Remover vínculo"}
                              </button>
                            ))
                        }
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
          <span>{total} usuários encontrados</span>
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
          <nav className={styles.actions} aria-label="Paginação de usuários">
            <span>
              Página {page} de {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <button
              disabled={loading || page === 1}
              onClick={() => {
                setPage((p) => p - 1);
                setLoading(true);
              }}
            >
              Anterior
            </button>
            <button
              disabled={loading || page * pageSize >= total}
              onClick={() => {
                setPage((p) => p + 1);
                setLoading(true);
              }}
            >
              Próxima
            </button>
          </nav>
        </footer>
      )}
    </section>
  );
}
