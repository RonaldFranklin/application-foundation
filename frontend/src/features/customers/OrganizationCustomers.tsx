"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { customerRequest, CustomerProfile } from "./api";
import styles from "./Customers.module.css";
type Detail = CustomerProfile & {
  invitation: {
    status: string;
    expiresAt: string;
    consumedAt: string | null;
    revokedAt: string | null;
    deliveredAt: string | null;
  } | null;
};
export default function OrganizationCustomers({
  permissions,
}: {
  permissions: readonly string[];
}) {
  const canRead = permissions.includes("customers.read"),
    canInvite = permissions.includes("customers.invite"),
    canManage = permissions.includes("customers.manage");
  const [items, setItems] = useState<CustomerProfile[]>([]),
    [detail, setDetail] = useState<Detail | null>(null);
  const [search, setSearch] = useState(""),
    [applied, setApplied] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const saving = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!canRead) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      setItems([]);
      setDetail(null);
      try {
        const query = new URLSearchParams({
          page: String(page),
          ...(applied ? { search: applied } : {}),
        });
        const r = await customerRequest<{
          items: CustomerProfile[];
          total: number;
        }>(`?${query}`, undefined, true, signal);
        setItems(r.items);
        setTotal(r.total);
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error ? e.message : "Não foi possível carregar.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canRead, applied, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void refresh(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [refresh]);
  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email"));
    void run(async () => {
      await customerRequest("/invite", { email }, true);
      form.reset();
      await refresh();
      setNotice("Convite enfileirado. A entrega será feita por e-mail.");
    });
  }
  const label = (status: string) =>
    status === "active"
      ? "Ativo"
      : status === "suspended"
        ? "Suspenso"
        : "Aguardando aceite";
  return (
    <section className={styles.card} aria-label="Clientes da organização">
      <h2>Clientes</h2>
      {canInvite && (
        <details>
          <summary>Convidar cliente</summary>
          <form onSubmit={invite}>
            <label>
              E-mail do cliente
              <input name="email" type="email" maxLength={254} required />
            </label>
            <button disabled={busy}>Enviar convite</button>
          </form>
        </details>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {canRead && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(search.trim());
              setPage(1);
            }}
          >
            <label>
              Buscar por e-mail completo
              <input
                type="email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={254}
              />
            </label>
            <div className={styles.actions}>
              <button disabled={busy}>Buscar</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSearch("");
                  setApplied("");
                  setPage(1);
                }}
              >
                Limpar
              </button>
              <button type="button" disabled={busy} onClick={() => refresh()}>
                Atualizar
              </button>
            </div>
          </form>
          {loading ? (
            <p role="status">Carregando clientes…</p>
          ) : error ? (
            <button onClick={() => refresh()}>Tentar novamente</button>
          ) : !items.length ? (
            <p>Nenhum cliente encontrado.</p>
          ) : (
            <div
              className={styles.table}
              tabIndex={0}
              role="region"
              aria-label="Tabela de clientes"
            >
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>E-mail</th>
                    <th>Estado</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name ?? "Convite pendente"}</td>
                      <td>{c.email}</td>
                      <td>{label(c.status)}</td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () =>
                              setDetail(
                                await customerRequest<Detail>(
                                  `/${c.id}`,
                                  undefined,
                                  true,
                                ),
                              ),
                            )
                          }
                        >
                          Ver detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && (
            <nav className={styles.actions} aria-label="Paginação de clientes">
              <button
                disabled={busy || page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} · {total} clientes
              </span>
              <button
                disabled={busy || page * 10 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
      {detail && (
        <section className={styles.card} aria-label="Detalhes do cliente">
          <h3>{detail.name ?? "Convite pendente"}</h3>
          <dl>
            <dt>E-mail</dt>
            <dd>{detail.email}</dd>
            <dt>Estado</dt>
            <dd>{label(detail.status)}</dd>
            <dt>MFA</dt>
            <dd>{detail.mfaEnabled ? "Ativado" : "Desativado"}</dd>
          </dl>
          {detail.invitation && (
            <p>
              Convite: {detail.invitation.status}. Validade:{" "}
              {new Date(detail.invitation.expiresAt).toLocaleString("pt-BR")}.{" "}
              {detail.invitation.deliveredAt
                ? "Enviado por e-mail."
                : "Sem confirmação de envio."}
            </p>
          )}
          <div className={styles.actions}>
            {canInvite && detail.status === "pending" && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await customerRequest(`/${detail.id}/resend`, {}, true);
                      await refresh();
                      setNotice("Novo convite enfileirado.");
                    })
                  }
                >
                  Reemitir convite
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Cancelar o convite?"))
                      void run(async () => {
                        await customerRequest(`/${detail.id}/cancel`, {}, true);
                        await refresh();
                        setNotice("Convite cancelado.");
                      });
                  }}
                >
                  Cancelar convite
                </button>
              </>
            )}
            {canManage && detail.status !== "pending" && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `${detail.status === "active" ? "Suspender" : "Reativar"} este cliente?`,
                    )
                  )
                    void run(async () => {
                      await customerRequest(
                        `/${detail.id}/status`,
                        {
                          status:
                            detail.status === "active" ? "suspended" : "active",
                        },
                        true,
                      );
                      await refresh();
                      setNotice("Estado atualizado.");
                    });
                }}
              >
                {detail.status === "active"
                  ? "Suspender cliente"
                  : "Reativar cliente"}
              </button>
            )}
            <button onClick={() => setDetail(null)}>Fechar detalhes</button>
          </div>
        </section>
      )}
    </section>
  );
}
