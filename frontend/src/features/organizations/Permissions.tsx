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
  "organization.update": "Editar nome e alterar o estado da organização.",
  "members.read": "Listar, buscar e filtrar os membros.",
  "members.create": "Cadastrar contas com senha temporária.",
  "members.link": "Vincular contas comuns já existentes.",
  "members.roles": "Alterar cargos e designar administradores.",
  "members.remove": "Remover o vínculo, preservando a conta.",
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
    <section className={styles.overview} aria-labelledby="permissions-heading">
      <h2 id="permissions-heading">Cargos e permissões</h2>
      <p>
        Os cargos e permissões valem somente nesta organização. O Master da
        plataforma é uma autoridade global distinta.
      </p>
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
              <span>2 cargos · {entries.length} permissões</span>
              <span>
                {dirty ? "Editando — alterações pendentes" : "Valores salvos"}
              </span>
            </div>
            <div
              className={styles.matrixScroll}
              role="region"
              aria-label="Matriz de permissões por cargo"
              tabIndex={0}
            >
              <table className={styles.matrix}>
                <caption>Cargos nas linhas e permissões nas colunas</caption>
                <thead>
                  <tr>
                    <th scope="col">Cargo</th>
                    {entries.map(([key, label]) => (
                      <th scope="col" key={key}>
                        {label}
                        <small>{descriptions[key]}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">
                      Administrador da organização
                      <small>Acesso geral protegido</small>
                    </th>
                    {entries.map(([key, label]) => (
                      <td key={key}>
                        <input
                          type="checkbox"
                          checked
                          disabled
                          aria-label={`Administrador da organização — ${label} — fixa`}
                        />
                        <small>Fixa</small>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">
                      Membro<small>Usuário comum</small>
                    </th>
                    {entries.map(([key, label]) => (
                      <td
                        key={key}
                        data-changed={
                          selected.includes(key) !==
                          settings.roles.MEMBER.permissions.includes(key)
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={busy}
                          aria-label={`Membro — ${label}`}
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
                          {selected.includes(key)
                            ? "Concedida"
                            : "Não concedida"}
                        </small>
                        {selected.includes(key) !==
                          settings.roles.MEMBER.permissions.includes(key) && (
                          <small>Alterada</small>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={styles.matrixHint}>
              Sem concessões, o Membro acessa somente as áreas pessoais. Alterar
              cargos permite designar administradores; administrar permissões
              permite conceder acesso ao cargo Membro.
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
                  {busy ? "Salvando…" : "Salvar permissões"}
                </button>
              </div>
            </footer>
          </form>
        </>
      )}
    </section>
  );
}
