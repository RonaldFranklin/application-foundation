"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { auditApi, type AuditPage, type AuditDetail } from "./api";
import styles from "./Audit.module.css";
const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
const outcome = (value: string) => (value === "success" ? "Sucesso" : "Falha");
const emptyFilters = { from: "", to: "", action: "", outcome: "" };
export default function Audit() {
  const [draft, setDraft] = useState(emptyFilters);
  const [query, setQuery] = useState({
    ...emptyFilters,
    page: 1,
    pageSize: 10,
  });
  const [result, setResult] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    for (const key of ["from", "to", "action", "outcome"] as const)
      if (query[key]) params.set(key, query[key]);
    void auditApi<AuditPage>(`?${params}`, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar a auditoria.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  function refresh() {
    setLoading(true);
    setError("");
    setRevision((v) => v + 1);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const from = draft.from ? new Date(draft.from) : null,
      to = draft.to ? new Date(draft.to) : null;
    if (
      (from && !Number.isFinite(+from)) ||
      (to && !Number.isFinite(+to)) ||
      (from && to && from > to)
    ) {
      setFormError("O início do período deve ser anterior ou igual ao fim.");
      return;
    }
    setFormError("");
    setError("");
    setLoading(true);
    setQuery({
      ...draft,
      from: from?.toISOString() ?? "",
      to: to?.toISOString() ?? "",
      page: 1,
      pageSize: query.pageSize,
    });
  }
  function paginate(page: number, pageSize = query.pageSize) {
    setLoading(true);
    setError("");
    setQuery({ ...query, page, pageSize });
  }
  function close() {
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Auditoria</h1>
          <p>Histórico de segurança e administração da plataforma</p>
        </div>
        <button onClick={refresh} disabled={loading}>
          Atualizar
        </button>
      </header>
      <form
        className={styles.filters}
        onSubmit={apply}
        aria-label="Filtros de auditoria"
        aria-describedby="audit-period-hint"
      >
        <label>
          De
          <input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          Até
          <input
            type="datetime-local"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          Ação
          <select
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">Todas as ações</option>
            {result?.actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resultado
          <select
            value={draft.outcome}
            onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="success">Sucesso</option>
            <option value="failure">Falha</option>
          </select>
        </label>
        <button type="submit">Aplicar filtros</button>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyFilters);
            setFormError("");
            setError("");
            setLoading(true);
            setQuery({ ...emptyFilters, page: 1, pageSize: query.pageSize });
          }}
        >
          Limpar filtros
        </button>
        <p id="audit-period-hint" className={styles.hint}>
          Datas no seu horário local. Ator e organização mostram nomes atuais;
          não há pesquisa por esses campos.
        </p>
      </form>
      {formError && (
        <p role="alert" className={styles.error}>
          {formError}
        </p>
      )}
      {loading ? (
        <p role="status" className={styles.state}>
          Carregando auditoria…
        </p>
      ) : error ? (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button onClick={refresh}>Tentar novamente</button>
        </div>
      ) : (
        result && (
          <>
            <p role="status" className={styles.summary}>
              {result.total} eventos encontrados
            </p>
            {result.items.length ? (
              <div
                role="region"
                aria-label="Tabela de auditoria"
                tabIndex={0}
                className={styles.tableWrap}
              >
                <table>
                  <thead>
                    <tr>
                      {[
                        "Data e hora",
                        "Ação",
                        "Ator",
                        "Organização",
                        "Recurso",
                        "Resultado",
                        "Detalhes",
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <time dateTime={item.occurredAt}>
                            {date(item.occurredAt)}
                          </time>
                        </td>
                        <th scope="row">{item.actionLabel}</th>
                        <td>{item.actor}</td>
                        <td>{item.organization ?? "Não se aplica"}</td>
                        <td>{item.resource}</td>
                        <td>
                          <span
                            className={
                              item.outcome === "success"
                                ? styles.success
                                : styles.failure
                            }
                          >
                            {outcome(item.outcome)}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`Ver detalhes: ${item.actionLabel}, ${date(item.occurredAt)}`}
                            onClick={(e) => {
                              trigger.current = e.currentTarget;
                              setSelected(item.id);
                            }}
                          >
                            Ver detalhes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.state}>
                <h2>Nenhum evento encontrado</h2>
                <p>Não há eventos registrados para os filtros selecionados.</p>
              </div>
            )}
          </>
        )
      )}
      <footer className={styles.footer}>
        <label>
          Itens por página
          <select
            value={query.pageSize}
            onChange={(e) => paginate(1, Number(e.target.value))}
          >
            {[5, 10, 25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Paginação da auditoria">
          <span>
            Página {query.page} de{" "}
            {Math.max(
              query.page,
              Math.ceil((result?.total ?? 0) / query.pageSize),
            )}
          </span>
          <button
            disabled={loading || query.page === 1}
            onClick={() => paginate(query.page - 1)}
          >
            Anterior
          </button>
          <button
            disabled={
              loading ||
              !!error ||
              !result ||
              query.page * query.pageSize >= result.total
            }
            onClick={() => paginate(query.page + 1)}
          >
            Próxima
          </button>
        </nav>
      </footer>
      {selected && <EventDialog key={selected} id={selected} onClose={close} />}
    </section>
  );
}
function EventDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void auditApi<AuditDetail>(`/${encodeURIComponent(id)}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar o evento.",
          );
      });
    return () => controller.abort();
  }, [id, revision]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="audit-detail-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="audit-detail-title">Detalhes do evento</h2>
        <button autoFocus onClick={onClose}>
          Fechar
        </button>
      </header>
      {error ? (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button
            onClick={() => {
              setError("");
              setRevision((v) => v + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      ) : !detail ? (
        <p role="status">Carregando evento…</p>
      ) : (
        <>
          <dl>
            {[
              ["Ação", detail.actionLabel],
              ["Data e hora", date(detail.occurredAt)],
              ["Resultado", outcome(detail.outcome)],
              ["Ator", detail.actor],
              ["Organização", detail.organization ?? "Não se aplica"],
              ["Tipo de recurso", detail.resourceType],
              ["Recurso", detail.resource],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Detalhes registrados</h3>
          {detail.metadata.length ? (
            <dl>
              {detail.metadata.map((entry, i) => (
                <div key={i}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>Nenhum detalhe adicional foi registrado.</p>
          )}
          <p className={styles.hint}>
            Nomes atuais são exibidos para referência. Valores anteriores que
            não foram registrados não são reconstruídos.
          </p>
        </>
      )}
    </dialog>
  );
}
