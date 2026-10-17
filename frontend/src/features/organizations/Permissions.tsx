"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  organizationsApi,
  OrganizationRequestError,
  type PermissionSettings,
  type OrganizationPermission,
} from "./api";
import styles from "./Organizations.module.css";
const descriptions: Record<OrganizationPermission, string> = {
  "organization.read": "Consultar os dados da organização.",
  "organization.update":
    "Editar o nome. Ativação e desativação são exclusivas do Master.",
  "members.read": "Listar, buscar e filtrar os membros.",
  "members.create":
    "Permitir convites em conjunto com Vincular contas existentes.",
  "members.link":
    "Permitir convites em conjunto com Cadastrar usuários; o destinatário deve aceitar.",
  "members.remove":
    "Remover vínculos de Membro, preservando a conta. Administradores são geridos somente pelo Master.",
  "permissions.manage": "Consultar e alterar as concessões do Membro.",
};
export default function Permissions({
  organizationId,
  master = true,
}: {
  organizationId: string;
  master?: boolean;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<PermissionSettings | null>(null);
  const [selected, setSelected] = useState<OrganizationPermission[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const sending = useRef(false);
  const path = `/${encodeURIComponent(organizationId)}/permissions`;
  useEffect(() => {
    const controller = new AbortController();
    organizationsApi<PermissionSettings>(
      path,
      undefined,
      controller.signal,
      master,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setSettings(data);
          setSelected(data.roles.MEMBER.permissions);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof OrganizationRequestError
              ? e.message
              : "Não foi possível carregar as permissões.",
          );
      });
    return () => controller.abort();
  }, [path, master, revision]);
  const entries = Object.entries(settings?.catalog ?? {}) as [
    OrganizationPermission,
    string,
  ][];
  const dirty =
    !!settings &&
    (selected.length !== settings.roles.MEMBER.permissions.length ||
      selected.some((key) => !settings.roles.MEMBER.permissions.includes(key)));
  return (
    <section
      className={styles.permissionPanel}
      aria-labelledby="permissions-heading"
    >
      <header className={styles.permissionHeader}>
        <div>
          <h2 id="permissions-heading">Cargos e permissões</h2>
          <p>
            {settings
              ? `${Object.keys(settings.roles).length} cargos · ${entries.length} permissões`
              : "Permissões desta organização"}
          </p>
        </div>
        {settings && (
          <span className={styles.permissionEditing}>
            {busy
              ? "Salvando…"
              : dirty
                ? "Editando · alterações pendentes"
                : "Valores salvos"}
          </span>
        )}
      </header>
      {error && (
        <p role="alert" id="permissions-error" className={styles.error}>
          {error}
        </p>
      )}
      {!settings ? (
        error ? (
          <button onClick={() => setRevision((n) => n + 1)}>
            Tentar novamente
          </button>
        ) : (
          <p role="status">Carregando permissões…</p>
        )
      ) : (
        <>
          <form
            className={styles.matrixForm}
            aria-label="Permissões do Membro"
            aria-busy={busy}
            aria-describedby={error ? "permissions-error" : undefined}
            onSubmit={async (e) => {
              e.preventDefault();
              if (sending.current || !dirty) return;
              sending.current = true;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const data = await organizationsApi<PermissionSettings>(
                  path,
                  { role: "MEMBER", permissions: selected },
                  undefined,
                  master,
                );
                setSettings(data);
                setSelected(data.roles.MEMBER.permissions);
                setNotice("Permissões salvas.");
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof OrganizationRequestError
                    ? e.message
                    : "Não foi possível salvar as permissões.",
                );
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          >
            <div className={styles.matrixSummary}>
              <span>
                Escopo: esta organização · Administrador com acesso fixo
              </span>
              <div className={styles.actions}>
                <span className={styles.roleBadge}>
                  Administrador{" "}
                  {settings.roles.ORGANIZATION_ADMIN.permissions.length}/
                  {entries.length}
                </span>
                <span className={styles.roleBadge}>
                  Membro {selected.length}/{entries.length}
                </span>
              </div>
            </div>
            <div
              className={styles.matrixScroll}
              role="region"
              aria-label="Matriz de permissões por cargo"
              tabIndex={0}
            >
              <table className={styles.matrix}>
                <caption className={styles.srOnly}>
                  Permissões nas linhas e cargos nas colunas. Somente o Membro
                  pode receber concessões editáveis.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Permissão</th>
                    <th scope="col">
                      Administrador da organização<small>Acesso fixo</small>
                    </th>
                    <th scope="col">
                      Membro<small>Concessões editáveis</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([key, label]) => {
                    const changed =
                      selected.includes(key) !==
                      settings.roles.MEMBER.permissions.includes(key);
                    return (
                      <tr key={key}>
                        <th scope="row">
                          {label}
                          <small>{descriptions[key]}</small>
                        </th>
                        <td>
                          <input
                            type="checkbox"
                            checked={settings.roles.ORGANIZATION_ADMIN.permissions.includes(
                              key,
                            )}
                            disabled
                            aria-label={`Administrador da organização — ${label} — fixa`}
                          />
                          <small>Fixa</small>
                        </td>
                        <td data-changed={changed}>
                          <input
                            type="checkbox"
                            disabled={busy || settings.roles.MEMBER.protected}
                            aria-label={`Membro — ${label}`}
                            onFocus={(event) =>
                              event.currentTarget.scrollIntoView({
                                block: "nearest",
                                inline: "nearest",
                              })
                            }
                            checked={selected.includes(key)}
                            onChange={(e) => {
                              setNotice("");
                              setSelected((values) =>
                                e.target.checked
                                  ? [...values, key]
                                  : values.filter((v) => v !== key),
                              );
                            }}
                          />
                          <small>
                            {changed ? "Alterada · " : ""}
                            {selected.includes(key)
                              ? "Concedida"
                              : "Não concedida"}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.matrixHint}>
              Sem concessões, o Membro acessa somente as áreas pessoais. Alterar
              cargos é exclusivo do Master; administrar permissões permite
              conceder acesso ao cargo Membro.
            </p>
            <footer className={styles.footer}>
              <span role="status">
                {busy
                  ? "Salvando permissões…"
                  : notice ||
                    (dirty
                      ? "Alterações não salvas."
                      : "Nenhuma alteração pendente.")}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy || !dirty}
                  onClick={() => {
                    setSelected([...settings.roles.MEMBER.permissions]);
                    setError("");
                    setNotice("Alterações descartadas.");
                  }}
                >
                  Descartar
                </button>
                <button className={styles.primary} disabled={busy || !dirty}>
                  {busy ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </footer>
          </form>
        </>
      )}
    </section>
  );
}
