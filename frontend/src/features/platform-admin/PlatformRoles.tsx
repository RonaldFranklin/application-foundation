"use client";
import { useEffect, useRef, useState } from "react";
import { platformRequest } from "./api";
import styles from "./PlatformAdmins.module.css";
import matrixStyles from "../organizations/Organizations.module.css";
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
  const [selectedRole, setSelectedRole] = useState("");
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
  const entries = Object.entries(settings?.catalog ?? {});
  const changedRole = drafts.find(
    (role) =>
      JSON.stringify(role) !==
      JSON.stringify(settings?.roles.find((saved) => saved.id === role.id)),
  );
  const managedRole =
    drafts.find((role) => role.id === selectedRole) ?? drafts[0];
  return (
    <div className={`${matrixStyles.container} ${styles.rolesWorkspace}`}>
      <section
        className={`${matrixStyles.permissionPanel} ${styles.rolesPanel}`}
        aria-labelledby="platform-roles-title"
      >
        <header className={matrixStyles.permissionHeader}>
          <div>
            <h1 id="platform-roles-title" tabIndex={-1} ref={heading}>
              Cargos e permissões da plataforma
            </h1>
            <p>
              {settings
                ? `${drafts.length + 1} cargos · ${entries.length} permissões`
                : "Permissões globais da plataforma"}
            </p>
          </div>
          {settings && (
            <span className={matrixStyles.permissionEditing}>
              {busy
                ? "Salvando…"
                : dirty || name.trim()
                  ? "Editando · alterações pendentes"
                  : "Valores salvos"}
            </span>
          )}
        </header>
        {error && (
          <p className={matrixStyles.error} role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className={styles.state} role="status">
            Carregando cargos…
          </p>
        ) : !settings ? (
          <div className={matrixStyles.footer}>
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
            <div className={matrixStyles.matrixSummary}>
              <span>Escopo: plataforma · Master com acesso fixo</span>
              <div className={matrixStyles.actions}>
                <span className={matrixStyles.roleBadge}>
                  Master {entries.length}/{entries.length}
                </span>
                {drafts.map((role) => (
                  <span className={matrixStyles.roleBadge} key={role.id}>
                    {role.name} {role.permissions.length}/{entries.length}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.roleManagement}>
              <form
                className={styles.roleEditor}
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
              {managedRole && (
                <div
                  className={styles.roleEditor}
                  role="group"
                  aria-label="Administrar cargo"
                >
                  <label>
                    Cargo
                    <select
                      value={managedRole.id}
                      disabled={busy || dirty || !!name.trim()}
                      onChange={(e) => setSelectedRole(e.target.value)}
                    >
                      {drafts.map((role) => (
                        <option key={role.id} value={role.id}>
                          {
                            settings.roles.find((saved) => saved.id === role.id)
                              ?.name
                          }
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Nome do cargo{" "}
                    {
                      settings.roles.find((role) => role.id === managedRole.id)
                        ?.name
                    }
                    <input
                      value={managedRole.name}
                      maxLength={80}
                      disabled={
                        busy || otherDirty(managedRole.id) || !!name.trim()
                      }
                      onChange={(e) =>
                        edit(managedRole.id, { name: e.target.value })
                      }
                    />
                  </label>
                  <button
                    disabled={busy || dirty || !!name.trim()}
                    onClick={() => {
                      trigger.current = document.activeElement as HTMLElement;
                      setRemove(managedRole);
                    }}
                  >
                    Excluir {managedRole.name}
                  </button>
                </div>
              )}
            </div>
            {!drafts.length && (
              <p className={matrixStyles.matrixHint}>
                Nenhum cargo criado. As concessões individuais existentes
                permanecem válidas.
              </p>
            )}
            <div className={matrixStyles.matrixForm} aria-busy={busy}>
              <div
                className={`${matrixStyles.matrixScroll} ${styles.roleMatrixScroll}`}
                role="region"
                aria-label="Matriz de permissões da plataforma"
                tabIndex={0}
              >
                <table
                  className={`${matrixStyles.matrix} ${styles.roleMatrix}`}
                >
                  <caption className={matrixStyles.srOnly}>
                    Permissões globais nas linhas e cargos nas colunas. O acesso
                    do Master é fixo.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Permissão</th>
                      <th scope="col">
                        Master<small>Acesso fixo</small>
                      </th>
                      {drafts.map((role) => (
                        <th scope="col" key={role.id}>
                          {role.name}
                          <small>Concessões editáveis</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(([key, label]) => (
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
                        {drafts.map((role) => {
                          const changed =
                            role.permissions.includes(key) !==
                            settings.roles
                              .find((saved) => saved.id === role.id)
                              ?.permissions.includes(key);
                          return (
                            <td key={role.id} data-changed={changed}>
                              <input
                                type="checkbox"
                                disabled={
                                  busy || otherDirty(role.id) || !!name.trim()
                                }
                                aria-label={`${role.name} — ${label}`}
                                checked={role.permissions.includes(key)}
                                onFocus={(e) =>
                                  e.currentTarget.scrollIntoView({
                                    block: "nearest",
                                    inline: "nearest",
                                  })
                                }
                                onChange={(e) => {
                                  setSelectedRole(role.id);
                                  edit(role.id, {
                                    permissions: e.target.checked
                                      ? [...role.permissions, key]
                                      : role.permissions.filter(
                                          (p) => p !== key,
                                        ),
                                  });
                                }}
                              />
                              <small>
                                {changed ? "Alterada · " : ""}
                                {role.permissions.includes(key)
                                  ? "Concedida"
                                  : "Não concedida"}
                              </small>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={matrixStyles.matrixHint}>
                Cargos novos começam sem permissões. Edite um cargo por vez.
                Alterar permissões encerra as sessões das contas vinculadas e
                atualiza convites ainda não aceitos. O Master não pode ser
                editado, removido ou atribuído.
              </p>
              <footer className={matrixStyles.footer}>
                <span role="status">
                  {busy
                    ? "Salvando…"
                    : notice ||
                      (dirty
                        ? "Alterações não salvas."
                        : name.trim()
                          ? "Novo cargo não criado."
                          : "Nenhuma alteração pendente.")}
                </span>
                <div className={matrixStyles.actions}>
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
                  <button
                    disabled={busy || (!dirty && !name)}
                    onClick={discard}
                  >
                    Descartar
                  </button>
                  <button
                    className={matrixStyles.primary}
                    disabled={busy || !changedRole || !changedRole.name.trim()}
                    onClick={() => {
                      if (changedRole)
                        void mutate(
                          `admin/platform-admins/roles/${changedRole.id}`,
                          {
                            name: changedRole.name,
                            permissions: changedRole.permissions,
                            version: changedRole.version,
                          },
                        );
                    }}
                  >
                    Salvar alterações
                  </button>
                </div>
              </footer>
            </div>
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
                  void mutate(
                    `admin/platform-admins/roles/${remove.id}/remove`,
                    {
                      version: remove.version,
                    },
                  )
                }
              >
                Confirmar exclusão
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </dialog>
        )}
      </section>
    </div>
  );
}
