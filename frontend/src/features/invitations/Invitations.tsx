"use client";
import { useEffect, useRef, useState } from "react";
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
  onBusyChange,
  onCountChange,
  sent = false,
}: {
  onCountChange?: (count: number | null) => void;
  sent?: boolean;
  onBusyChange?: (busy: boolean) => void;
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
    invitationApi<{ items: Item[] }>(path, undefined, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) {
          setItems(r.items);
          onCountChange?.(r.items.length);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          onCountChange?.(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, canRead, revision, onCountChange]);
  async function mutate(suffix: string, body: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      await invitationApi(path + suffix, body);
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
        <h3 id="invitations-heading" ref={heading} tabIndex={-1}>
          Convites pendentes
        </h3>
      </header>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" id="invitation-list-error" className={styles.error}>
          {error}
        </p>
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
                <div
                  className={styles.tableWrap}
                  tabIndex={0}
                  role="region"
                  aria-label="Lista de convites pendentes"
                >
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
