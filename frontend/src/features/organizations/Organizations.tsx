"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ActionMenu from "./ActionMenu";
import {
  allPermissions,
  type OrganizationPermission,
  organizationsApi,
  OrganizationRequestError,
  type Organization,
  type OrganizationPage,
} from "./api";
import Permissions from "./Permissions";
import Members from "./Members";
import styles from "./Organizations.module.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
function Status({ active }: { active: boolean }) {
  return (
    <span className={active ? styles.active : styles.inactive}>
      {active ? "Ativa" : "Inativa"}
    </span>
  );
}
function Editor({
  organization,
  master,
  onSaved,
  onCancel,
}: {
  organization: Organization | null;
  master: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(organization?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await organizationsApi(
        organization ? `/${organization.id}` : "",
        {
          name: name.trim(),
        },
        undefined,
        master,
      );
      onSaved();
    } catch (e) {
      setError(
        e instanceof OrganizationRequestError
          ? e.message
          : "Não foi possível salvar.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.editor}
      onSubmit={submit}
      aria-label={organization ? "Editar organização" : "Adicionar organização"}
    >
      <h2>{organization ? "Editar organização" : "Adicionar organização"}</h2>
      <label htmlFor="organization-name">Nome da organização</label>
      <input
        id="organization-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={200}
        autoFocus
        disabled={busy}
      />
      <p>O nome pode ser igual ao de outra organização.</p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy || !name.trim()}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
export default function Organizations({
  id,
  master = true,
  permissions = allPermissions,
  currentUserId,
}: {
  id?: string;
  master?: boolean;
  permissions?: readonly OrganizationPermission[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab =
    searchParams.get("tab") ||
    (permissions.includes("organization.read")
      ? "overview"
      : permissions.some((p) => p.startsWith("members."))
        ? "users"
        : permissions.includes("permissions.manage")
          ? "permissions"
          : "overview");
  const membersTab = tab === "users";
  const permissionsTab = tab === "permissions";
  const canRead = permissions.includes("organization.read");
  const canUpdate = permissions.includes("organization.update");
  const base = master ? "/admin/organizations" : "/organizations";
  const [result, setResult] = useState<OrganizationPage | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [deleted, setDeleted] = useState(
    searchParams.get("deleted") === "true",
  );
  const [selected, setSelected] = useState<Organization | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Organization | null | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          if (id)
            setOrganization(
              await organizationsApi<Organization>(
                `/${encodeURIComponent(id)}${canRead ? "" : "/access"}`,
                undefined,
                controller.signal,
                master,
              ),
            );
          else {
            const query = new URLSearchParams({
              search,
              deleted: String(deleted),
              page: String(page),
              pageSize: String(pageSize),
              ...(status ? { status } : {}),
            });
            const data = await organizationsApi<OrganizationPage>(
              `?${query}`,
              undefined,
              controller.signal,
            );
            if (!controller.signal.aborted) {
              if (page > 1 && data.items.length === 0)
                setPage(Math.max(1, Math.ceil(data.total / pageSize)));
              setResult(data);
            }
          }
        } catch (e) {
          if (!controller.signal.aborted)
            setError(
              e instanceof OrganizationRequestError
                ? e.message
                : "Não foi possível carregar.",
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
  }, [id, search, status, deleted, page, pageSize, revision, master, canRead]);
  function refresh() {
    setLoading(true);
    setRevision((v) => v + 1);
  }
  function closeEditor() {
    setEditing(undefined);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }
  async function toggle(item: Organization) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await organizationsApi(
        `/${item.id}`,
        { active: !item.active },
        undefined,
        master,
      );
      setNotice(
        item.active ? "Organização desativada." : "Organização ativada.",
      );
      refresh();
    } catch (e) {
      setError(
        e instanceof OrganizationRequestError
          ? e.message
          : "Não foi possível alterar o estado.",
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  function selectDeletion(
    item: Organization,
    trigger: HTMLButtonElement | null,
  ) {
    editTrigger.current = trigger;
    setSelected(item);
    setNotice("");
    setError("");
  }
  function cancelDeletion() {
    setSelected(null);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }
  async function confirmDeletion(event: FormEvent) {
    event.preventDefault();
    if (!selected || mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    try {
      await organizationsApi(
        `/${selected.id}/${selected.deletedAt ? "restore" : "remove"}`,
        {},
      );
      const wasDeleted = Boolean(selected.deletedAt);
      setSelected(null);
      setNotice(
        wasDeleted
          ? "Organização restaurada e ativada."
          : "Organização excluída. Seus dados e vínculos foram preservados.",
      );
      if (id) router.push(`${base}?deleted=true`);
      else {
        refresh();
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch (e) {
      setError(
        e instanceof OrganizationRequestError
          ? e.message
          : "Não foi possível alterar a organização.",
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  function actions(item: Organization) {
    if (!id)
      return (
        <ActionMenu
          label={`Ações de ${item.name}`}
          icon="pencil"
          disabled={busy || editing !== undefined || selected !== null}
        >
          {(trigger) => (
            <>
              {!item.deletedAt && (
                <>
                  <Link href={`${base}/${item.id}`}>Abrir</Link>
                  <button
                    onClick={() => {
                      editTrigger.current = trigger;
                      setEditing(item);
                      setNotice("");
                    }}
                  >
                    Editar
                  </button>
                  <button onClick={() => toggle(item)}>
                    {item.active ? "Desativar" : "Ativar"}
                  </button>
                </>
              )}
              {master && (
                <button onClick={() => selectDeletion(item, trigger)}>
                  {item.deletedAt ? "Restaurar" : "Excluir"}
                </button>
              )}
            </>
          )}
        </ActionMenu>
      );
    return (
      <div className={styles.actions}>
        <button
          disabled={busy || editing !== undefined || selected !== null}
          onClick={(e) => {
            editTrigger.current = e.currentTarget;
            setEditing(item);
            setNotice("");
          }}
        >
          Editar
        </button>
        {master && (
          <button
            disabled={busy || editing !== undefined || selected !== null}
            onClick={() => toggle(item)}
          >
            {item.active ? "Desativar" : "Ativar"}
          </button>
        )}
        {master && (
          <button
            disabled={busy || editing !== undefined || selected !== null}
            onClick={(e) => selectDeletion(item, e.currentTarget)}
          >
            Excluir
          </button>
        )}
      </div>
    );
  }
  const visible =
    result && result.page === page && result.pageSize === pageSize;
  return (
    <section className={styles.container}>
      {id && (
        <nav className={styles.breadcrumb} aria-label="Caminho da organização">
          <Link href={base}>Organizações</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{organization?.name ?? "Visão geral"}</span>
        </nav>
      )}
      <header className={styles.header}>
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {id ? (organization?.name ?? "Organização") : "Organizações"}
          </h1>
          {id ? (
            organization && <Status active={organization.active} />
          ) : (
            <p>
              {result
                ? `${result.total} organizações encontradas`
                : "Gestão de organizações da plataforma"}
            </p>
          )}
        </div>
        {!id && (
          <button
            ref={addButton}
            className={styles.primary}
            disabled={editing !== undefined || busy || selected !== null}
            onClick={() => {
              editTrigger.current = addButton.current;
              setEditing(null);
              setNotice("");
            }}
          >
            Adicionar organização
          </button>
        )}
        {id && organization && canUpdate && actions(organization)}
      </header>
      {selected && (
        <form
          className={styles.editor}
          onSubmit={confirmDeletion}
          aria-label={
            selected.deletedAt ? "Restaurar organização" : "Excluir organização"
          }
          aria-describedby={error ? "organization-error" : undefined}
        >
          <h2>
            {selected.deletedAt ? "Restaurar" : "Excluir"} organização:{" "}
            {selected.name}
          </h2>
          <p>
            {selected.deletedAt
              ? "A organização voltará a ficar ativa. Os vínculos preservados voltarão a conceder acesso conforme seus papéis e permissões."
              : "O acesso será bloqueado. Dados e vínculos serão preservados para restauração pelo Master."}
          </p>
          <div className={styles.actions}>
            <button disabled={busy}>
              {busy
                ? "Salvando…"
                : selected.deletedAt
                  ? "Confirmar restauração"
                  : "Confirmar exclusão"}
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={cancelDeletion}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {editing !== undefined && (
        <Editor
          key={editing?.id ?? "new"}
          organization={editing}
          master={master}
          onCancel={closeEditor}
          onSaved={() => {
            closeEditor();
            setNotice("Organização salva.");
            refresh();
          }}
        />
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!id && (
        <div className={styles.toolbar}>
          <label>
            Visualização de organizações
            <select
              value={String(deleted)}
              disabled={busy || selected !== null || editing !== undefined}
              onChange={(e) => {
                setDeleted(e.target.value === "true");
                setPage(1);
                setLoading(true);
              }}
            >
              <option value="false">Não excluídas</option>
              <option value="true">Excluídas</option>
            </select>
          </label>
          <label>
            Buscar por nome
            <input
              type="search"
              placeholder="Buscar organizações…"
              value={search}
              maxLength={200}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setLoading(true);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
                setLoading(true);
              }}
            >
              <option value="">Todos os estados</option>
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </select>
          </label>
        </div>
      )}
      {id && (
        <nav className={styles.tabs} aria-label="Seções da organização">
          {(canRead || canUpdate) && (
            <Link
              href={`${base}/${id}?tab=overview`}
              scroll={false}
              aria-current={!membersTab && !permissionsTab ? "page" : undefined}
            >
              Visão geral
            </Link>
          )}
          {permissions.some((p) => p.startsWith("members.")) && (
            <Link
              href={`${base}/${id}?tab=users`}
              scroll={false}
              aria-current={membersTab ? "page" : undefined}
            >
              Usuários
            </Link>
          )}
          {permissions.includes("permissions.manage") && (
            <Link
              href={`${base}/${id}?tab=permissions`}
              scroll={false}
              aria-current={permissionsTab ? "page" : undefined}
            >
              Cargos e permissões
            </Link>
          )}
        </nav>
      )}
      {error && (
        <div id="organization-error" className={styles.error} role="alert">
          <p>{error}</p>
          <button onClick={refresh}>Tentar novamente</button>
        </div>
      )}
      {loading ? (
        <p role="status" className={styles.empty}>
          Carregando organizações…
        </p>
      ) : (
        !error &&
        (id
          ? organization &&
            !membersTab &&
            !permissionsTab &&
            canRead && (
              <div id="overview" className={styles.overview}>
                <h2>Informações da organização</h2>
                <dl>
                  <div>
                    <dt>Nome</dt>
                    <dd>{organization.name}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <Status active={organization.active} />
                    </dd>
                  </div>
                  <div>
                    <dt>Criada em</dt>
                    <dd>{date(organization.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Atualizada em</dt>
                    <dd>{date(organization.updatedAt)}</dd>
                  </div>
                </dl>
              </div>
            )
          : visible &&
            (result.items.length ? (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Tabela de organizações"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Organização</th>
                      <th>Usuários</th>
                      <th>Criada em</th>
                      <th>Status</th>
                      <th className={styles.actionCell}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">
                          {item.deletedAt ? (
                            item.name
                          ) : (
                            <Link href={`${base}/${item.id}`}>{item.name}</Link>
                          )}
                        </th>
                        <td>
                          {item.deletedAt ? (
                            "Vínculos preservados"
                          ) : (
                            <Link href={`${base}/${item.id}?tab=users`}>
                              Ver usuários
                            </Link>
                          )}
                        </td>
                        <td>{date(item.createdAt)}</td>
                        <td>
                          {item.deletedAt ? (
                            <span className={styles.inactive}>Excluída</span>
                          ) : (
                            <Status active={item.active} />
                          )}
                        </td>
                        <td className={styles.actionCell}>{actions(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                <h2>Nenhuma organização encontrada</h2>
                <p>
                  {search || status
                    ? "Ajuste a busca ou o filtro de status."
                    : "Adicione a primeira organização para começar."}
                </p>
              </div>
            )))
      )}
      {id &&
        organization &&
        !loading &&
        !error &&
        membersTab &&
        permissions.some((p) => p.startsWith("members.")) && (
          <Members
            key={`members-${id}`}
            organizationId={id}
            currentUserId={currentUserId}
            master={master}
            permissions={permissions}
          />
        )}
      {id &&
        organization &&
        !loading &&
        !error &&
        permissionsTab &&
        permissions.includes("permissions.manage") && (
          <Permissions organizationId={id} master={master} />
        )}
      {id && !membersTab && !permissionsTab && !canRead && (
        <p className={styles.empty}>
          Você não tem permissão para consultar os detalhes da organização.
        </p>
      )}
      {!id && (
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
          <nav aria-label="Paginação" className={styles.actions}>
            <span>
              Página {page} de{" "}
              {Math.max(1, Math.ceil((result?.total ?? 0) / pageSize))}
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
              disabled={loading || !result || page * pageSize >= result.total}
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
