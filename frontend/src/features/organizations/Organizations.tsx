"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ActionMenu from "./ActionMenu";
import {
  organizationsApi,
  type Organization,
  type OrganizationPage,
} from "./api";
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
  onSaved,
  onCancel,
}: {
  organization: Organization | null;
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
      await organizationsApi(organization ? `/${organization.id}` : "", {
        name: name.trim(),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
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
export default function Organizations({ id }: { id?: string }) {
  const membersTab = useSearchParams().get("tab") === "users";
  const [result, setResult] = useState<OrganizationPage | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
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
                `/${encodeURIComponent(id)}`,
                undefined,
                controller.signal,
              ),
            );
          else {
            const query = new URLSearchParams({
              search,
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
              e instanceof Error ? e.message : "Não foi possível carregar.",
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
  }, [id, search, status, page, pageSize, revision]);
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
      await organizationsApi(`/${item.id}`, { active: !item.active });
      setNotice(
        item.active ? "Organização desativada." : "Organização ativada.",
      );
      refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível alterar o estado.",
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
          disabled={busy || editing !== undefined}
        >
          {(trigger) => (
            <>
              <Link href={`/admin/organizations/${item.id}`}>Abrir</Link>
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
        </ActionMenu>
      );
    return (
      <div className={styles.actions}>
        <button
          disabled={busy || editing !== undefined}
          onClick={(e) => {
            editTrigger.current = e.currentTarget;
            setEditing(item);
            setNotice("");
          }}
        >
          Editar
        </button>
        <button
          disabled={busy || editing !== undefined}
          onClick={() => toggle(item)}
        >
          {item.active ? "Desativar" : "Ativar"}
        </button>
      </div>
    );
  }
  const visible =
    result && result.page === page && result.pageSize === pageSize;
  return (
    <section className={styles.container}>
      {id && (
        <nav className={styles.breadcrumb} aria-label="Caminho da organização">
          <Link href="/admin/organizations">Organizações</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{organization?.name ?? "Visão geral"}</span>
        </nav>
      )}
      <header className={styles.header}>
        <div>
          <h1>{id ? (organization?.name ?? "Organização") : "Organizações"}</h1>
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
            disabled={editing !== undefined || busy}
            onClick={() => {
              editTrigger.current = addButton.current;
              setEditing(null);
              setNotice("");
            }}
          >
            Adicionar organização
          </button>
        )}
        {id && organization && actions(organization)}
      </header>
      {editing !== undefined && (
        <Editor
          key={editing?.id ?? "new"}
          organization={editing}
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
          <Link
            href={`/admin/organizations/${id}`}
            scroll={false}
            aria-current={!membersTab ? "page" : undefined}
          >
            Visão geral
          </Link>
          <Link
            href={`/admin/organizations/${id}?tab=users`}
            scroll={false}
            aria-current={membersTab ? "page" : undefined}
          >
            Usuários
          </Link>
        </nav>
      )}
      {error && (
        <div className={styles.error} role="alert">
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
            !membersTab && (
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
                          <Link href={`/admin/organizations/${item.id}`}>
                            {item.name}
                          </Link>
                        </th>
                        <td>
                          <Link
                            href={`/admin/organizations/${item.id}?tab=users`}
                          >
                            Ver usuários
                          </Link>
                        </td>
                        <td>{date(item.createdAt)}</td>
                        <td>
                          <Status active={item.active} />
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
      {id && organization && !loading && !error && membersTab && (
        <Members key={`members-${id}`} organizationId={id} />
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
