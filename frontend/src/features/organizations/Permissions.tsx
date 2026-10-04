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
          <section
            className={styles.roleCard}
            aria-labelledby="admin-role-heading"
          >
            <h3 id="admin-role-heading">Administrador da organização</h3>
            <p>
              Acesso geral protegido. Todas as funcionalidades organizacionais
              estão habilitadas; este acesso não pode ser reduzido.
            </p>
            <ul>
              {Object.values(settings.catalog).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </section>
          <form
            className={styles.roleCard}
            aria-label="Permissões do Membro"
            aria-busy={busy}
            aria-describedby={error ? "permissions-error" : undefined}
            onSubmit={async (e) => {
              e.preventDefault();
              if (sending.current) return;
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
            <h3>Membro — Usuário comum</h3>
            <p>
              Sem concessões, acessa somente as áreas pessoais. As permissões
              abaixo se aplicam a todos os membros deste cargo.
            </p>
            <p>
              Alterar cargos permite designar administradores. Administrar
              permissões permite conceder acesso ao cargo Membro.
            </p>
            <fieldset disabled={busy} className={styles.permissionFields}>
              <legend>Permissões organizacionais</legend>
              {(
                Object.entries(settings.catalog) as [
                  OrganizationPermission,
                  string,
                ][]
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={(e) =>
                      setSelected((values) =>
                        e.target.checked
                          ? [...values, key]
                          : values.filter((v) => v !== key),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {notice && (
              <p role="status" className={styles.notice}>
                {notice}
              </p>
            )}
            <button className={styles.primary} disabled={busy}>
              {busy ? "Salvando…" : "Salvar permissões"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
