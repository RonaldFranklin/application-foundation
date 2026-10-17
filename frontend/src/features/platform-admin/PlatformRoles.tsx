"use client";
import { useEffect, useRef, useState } from "react";
import { platformRequest } from "./api";
import styles from "./PlatformAdmins.module.css";
export type PlatformRole = {
  id: string;
  name: string;
  permissions: string[];
  version: number;
};
type Settings = { roles: PlatformRole[]; catalog: Record<string, string> };
export default function PlatformRoles({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drafts, setDrafts] = useState<PlatformRole[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState<PlatformRole | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    platformRequest<Settings>(
      "admin/platform-admins/roles",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setSettings(data);
          setDrafts(data.roles);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível carregar os cargos.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (remove) dialog.current?.showModal();
  }, [remove]);
  const dirty =
    !!settings && JSON.stringify(drafts) !== JSON.stringify(settings.roles);
  useEffect(() => {
    onBusyChange(busy || dirty || !!name.trim());
    return () => onBusyChange(false);
  }, [busy, dirty, name, onBusyChange]);
  function discard() {
    setDrafts(settings?.roles ?? []);
    setName("");
    setError("");
    setNotice("Alterações descartadas.");
  }
  async function mutate(path: string, body: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await platformRequest(path, body);
      // Read the authoritative saved state before allowing another mutation.
      const saved = await platformRequest<Settings>(
        "admin/platform-admins/roles",
      );
      setSettings(saved);
      setDrafts(saved.roles);
      setName("");
      setRemove(null);
      setNotice("Cargos e permissões atualizados.");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const otherDirty = (id: string) =>
    drafts.some(
      (r) =>
        r.id !== id &&
        JSON.stringify(r) !==
          JSON.stringify(settings?.roles.find((saved) => saved.id === r.id)),
    );
  const edit = (id: string, changes: Partial<PlatformRole>) => {
    setDrafts((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...changes } : r)),
    );
    setNotice("");
  };
  return (
    <section
      className={styles.container}
      aria-labelledby="platform-roles-title"
    >
      <header className={styles.header}>
        <div>
          <h1 id="platform-roles-title" tabIndex={-1} ref={heading}>
            Cargos e permissões da plataforma
          </h1>
          <p>
            Somente o Master administra cargos. As seis permissões abaixo são o
            catálogo delegável existente.
          </p>
        </div>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className={styles.state} role="status">
          Carregando cargos…
        </p>
      ) : !settings ? (
        <div className={styles.footer}>
          <button
            onClick={() => {
              setError("");
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <form
            className={styles.toolbar}
            aria-label="Criar cargo da plataforma"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("admin/platform-admins/roles", {
                name,
                permissions: [],
              });
            }}
          >
            <label>
              Nome do novo cargo
              <input
                value={name}
                maxLength={80}
                required
                disabled={busy || dirty}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button disabled={busy || dirty || !name.trim()}>
              Criar cargo
            </button>
          </form>
          <p className={styles.matrixHint}>
            Cargos novos começam sem permissões. Contas e convites anteriores
            conservam suas concessões individuais até receberem um cargo. Master
            é protegido e não pode ser atribuído.
          </p>
          {!drafts.length ? (
            <p className={styles.state}>
              Nenhum cargo criado. As concessões individuais existentes
              permanecem válidas.
            </p>
          ) : (
            <div
              className={styles.table}
              role="region"
              aria-label="Matriz de permissões da plataforma"
              tabIndex={0}
            >
              <table className={`${styles.adminTable} ${styles.matrix}`}>
                <thead>
                  <tr>
                    <th scope="col">Permissão</th>
                    <th scope="col">Master · fixo</th>
                    {drafts.map((role) => (
                      <th scope="col" key={role.id}>
                        <label>
                          <span className={styles.srOnly}>
                            Nome do cargo{" "}
                            {settings.roles.find((r) => r.id === role.id)?.name}
                          </span>
                          <input
                            value={role.name}
                            maxLength={80}
                            disabled={
                              busy || otherDirty(role.id) || !!name.trim()
                            }
                            onChange={(e) =>
                              edit(role.id, { name: e.target.value })
                            }
                          />
                        </label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(settings.catalog).map(([key, label]) => (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>
                        <input
                          type="checkbox"
                          checked
                          disabled
                          aria-label={`Master — ${label}`}
                        />
                        <small>Fixa</small>
                      </td>
                      {drafts.map((role) => (
                        <td key={role.id}>
                          <input
                            type="checkbox"
                            disabled={
                              busy || otherDirty(role.id) || !!name.trim()
                            }
                            aria-label={`${role.name} — ${label}`}
                            checked={role.permissions.includes(key)}
                            onChange={(e) =>
                              edit(role.id, {
                                permissions: e.target.checked
                                  ? [...role.permissions, key]
                                  : role.permissions.filter((p) => p !== key),
                              })
                            }
                          />
                          <small>
                            {role.permissions.includes(key)
                              ? "Concedida"
                              : "Não concedida"}
                          </small>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Administrar cargo</th>
                    <td>Protegido</td>
                    {drafts.map((role) => {
                      const changed =
                        JSON.stringify(role) !==
                        JSON.stringify(
                          settings.roles.find((r) => r.id === role.id),
                        );
                      const otherDirty = drafts.some(
                        (r) =>
                          r.id !== role.id &&
                          JSON.stringify(r) !==
                            JSON.stringify(
                              settings.roles.find((saved) => saved.id === r.id),
                            ),
                      );
                      return (
                        <td key={role.id}>
                          <div className={styles.roleActions}>
                            <button
                              disabled={
                                busy || !changed || otherDirty || !!name.trim()
                              }
                              onClick={() =>
                                void mutate(
                                  `admin/platform-admins/roles/${role.id}`,
                                  {
                                    name: role.name,
                                    permissions: role.permissions,
                                    version: role.version,
                                  },
                                )
                              }
                            >
                              Salvar{" "}
                              {
                                settings.roles.find((r) => r.id === role.id)
                                  ?.name
                              }
                            </button>
                            <button
                              disabled={busy || dirty || !!name.trim()}
                              onClick={() => {
                                trigger.current =
                                  document.activeElement as HTMLElement;
                                setRemove(role);
                              }}
                            >
                              Excluir {role.name}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className={styles.matrixHint}>
            Edite um cargo por vez. Alterar permissões encerra as sessões das
            contas vinculadas e atualiza convites ainda não aceitos. Cargos
            associados a contas ou convites não podem ser excluídos.
          </p>
          <footer className={styles.footer}>
            <span role="status">
              {busy
                ? "Salvando…"
                : notice ||
                  (dirty
                    ? "Alterações não salvas. Edite um cargo por vez."
                    : "Nenhuma alteração pendente.")}
            </span>
            <button disabled={busy || (!dirty && !name)} onClick={discard}>
              Descartar
            </button>
            <button
              disabled={busy}
              onClick={() => {
                discard();
                setLoading(true);
                setRevision((n) => n + 1);
              }}
            >
              Atualizar cargos
            </button>
          </footer>
        </>
      )}
      {remove && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="remove-role-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              setRemove(null);
              requestAnimationFrame(() => trigger.current?.focus());
            }
          }}
        >
          <h2 id="remove-role-title">Excluir cargo {remove.name}?</h2>
          <p>
            Somente cargos sem contas ou convites associados podem ser
            excluídos.
          </p>
          <div className={styles.actions}>
            <button
              autoFocus
              disabled={busy}
              onClick={() => {
                setRemove(null);
                requestAnimationFrame(() => trigger.current?.focus());
              }}
            >
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void mutate(`admin/platform-admins/roles/${remove.id}/remove`, {
                  version: remove.version,
                })
              }
            >
              Confirmar exclusão
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </dialog>
      )}
    </section>
  );
}
