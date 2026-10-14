"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { invitationApi } from "./api";
import {
  type OrganizationPermission,
  type OrganizationRole,
  organizationRoleLabels,
} from "../organizations/api";
import styles from "../organizations/Organizations.module.css";
type Item = {
  id: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
};
export default function Invitations({
  organizationId,
  master,
  permissions,
}: {
  organizationId: string;
  master: boolean;
  permissions: readonly OrganizationPermission[];
}) {
  const canWrite =
    permissions.includes("members.create") &&
    permissions.includes("members.link");
  const canRead = permissions.includes("members.read");
  const path = `/${master ? "admin/" : ""}organizations/${encodeURIComponent(organizationId)}/invitations`;
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    pending = useRef(false);
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    invitationApi<{ items: Item[] }>(path, undefined, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setItems(r.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, canRead, revision]);
  async function mutate(suffix: string, body: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invitationApi(path + suffix, body);
      setEditing(false);
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
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void mutate("", { email: data.get("email"), role: data.get("role") });
  }
  if (!canRead && !canWrite) return null;
  return (
    <section className={styles.members} aria-labelledby="invitations-heading">
      <header className={styles.header}>
        <h3 id="invitations-heading" ref={heading} tabIndex={-1}>
          Convites pendentes
        </h3>
        {canWrite && (
          <button
            ref={trigger}
            disabled={busy || editing}
            onClick={() => {
              setEditing(true);
              setError("");
              setNotice("");
            }}
          >
            Convidar usuário
          </button>
        )}
      </header>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" id="invitation-error" className={styles.error}>
          {error}
        </p>
      )}
      {editing && (
        <form
          className={styles.editor}
          onSubmit={submit}
          aria-label="Convidar usuário"
          aria-describedby={error ? "invitation-error" : undefined}
        >
          <label>
            E-mail do convite
            <input
              name="email"
              type="email"
              maxLength={254}
              required
              autoFocus
              disabled={busy}
            />
          </label>
          <label>
            Papel do convite
            <select name="role" defaultValue="MEMBER" disabled={busy}>
              <option value="MEMBER">Membro</option>
              {permissions.includes("members.roles") && (
                <option value="ORGANIZATION_ADMIN">
                  Administrador da organização
                </option>
              )}
            </select>
          </label>
          <p>
            O destinatário receberá um link válido por sete dias. Nenhuma conta
            ou associação será criada antes da aceitação.
          </p>
          <div className={styles.actions}>
            <button disabled={busy}>
              {busy ? "Enviando…" : "Enviar convite"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                requestAnimationFrame(() => trigger.current?.focus());
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {canRead &&
        (loading ? (
          <p role="status">Carregando convites…</p>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setError("");
                setLoading(true);
                setRevision((n) => n + 1);
              }}
            >
              Atualizar convites
            </button>
            {!error &&
              (items.length ? (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>E-mail</th>
                        <th>Papel</th>
                        <th>Validade</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.id}>
                          <th scope="row">{i.email}</th>
                          <td>{organizationRoleLabels[i.role]}</td>
                          <td>
                            {new Date(i.expiresAt).toLocaleDateString("pt-BR")}
                          </td>
                          <td>
                            {canWrite && (
                              <div className={styles.actions}>
                                <button
                                  disabled={
                                    busy ||
                                    (i.role === "ORGANIZATION_ADMIN" &&
                                      !permissions.includes("members.roles"))
                                  }
                                  onClick={() =>
                                    void mutate(`/${i.id}/resend`, {})
                                  }
                                >
                                  Reenviar
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate(`/${i.id}/revoke`, {})
                                  }
                                >
                                  Cancelar convite
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Nenhum convite pendente.</p>
              ))}
          </>
        ))}
    </section>
  );
}
