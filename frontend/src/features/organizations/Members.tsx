"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  organizationsApi,
  OrganizationRequestError,
  organizationRoleLabels,
  type OrganizationMember,
  type OrganizationRole,
} from "./api";
import ActionMenu from "./ActionMenu";
import styles from "./Organizations.module.css";
function RoleOptions() {
  return Object.entries(organizationRoleLabels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}
export default function Members({
  organizationId,
}: {
  organizationId: string;
}) {
  const [items, setItems] = useState<OrganizationMember[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  const [selected, setSelected] = useState<{
    member: OrganizationMember;
    action: "role" | "remove";
  } | null>(null);
  const [role, setRole] = useState<OrganizationRole>("MEMBER");
  const [password, setPassword] = useState("");
  const mutating = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/${encodeURIComponent(organizationId)}/members`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await organizationsApi<{ items: OrganizationMember[] }>(
          path,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) setItems(data.items);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof OrganizationRequestError
              ? e.message
              : "Não foi possível carregar os usuários.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, revision]);
  function close(focusHeading = false) {
    setMode(null);
    setSelected(null);
    setPassword("");
    requestAnimationFrame(() => {
      if (!focusHeading && trigger.current?.isConnected)
        trigger.current.focus();
      else heading.current?.focus();
    });
  }
  async function mutate(suffix: string, body: object, message: string) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await organizationsApi(path + suffix, body);
      close(true);
      setNotice(message);
      setLoading(true);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof OrganizationRequestError
          ? e.message
          : "Não foi possível salvar.",
      );
    } finally {
      setPassword("");
      mutating.current = false;
      setBusy(false);
    }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate(
      "",
      {
        mode,
        email: data.get("email"),
        role,
        ...(mode === "new" ? { username: data.get("username"), password } : {}),
      },
      "Usuário adicionado à organização.",
    );
  }
  const editing = mode !== null || selected !== null;
  return (
    <section id="members" aria-labelledby="members-heading">
      <header className={styles.header}>
        <div>
          <h2 id="members-heading" ref={heading} tabIndex={-1}>
            Usuários da organização
          </h2>
          <p>Os papéis valem somente nesta organização.</p>
        </div>
        <ActionMenu
          label="Adicionar usuário"
          icon="plus"
          disabled={editing || busy}
        >
          {(button) =>
            (["new", "existing"] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  trigger.current = button;
                  setMode(value);
                  setRole("MEMBER");
                  setError("");
                  setNotice("");
                }}
              >
                {value === "new"
                  ? "Cadastrar usuário"
                  : "Vincular conta existente"}
              </button>
            ))
          }
        </ActionMenu>
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <div id="members-error" className={styles.error} role="alert">
          <p>{error}</p>
          {!editing && (
            <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {mode && (
        <form
          className={styles.editor}
          aria-describedby={error ? "members-error" : undefined}
          onSubmit={add}
          aria-label={
            mode === "new" ? "Cadastrar usuário" : "Vincular conta existente"
          }
        >
          <h3>
            {mode === "new" ? "Cadastrar usuário" : "Vincular conta existente"}
          </h3>
          {mode === "new" && (
            <label>
              Usuário
              <input
                name="username"
                required
                maxLength={100}
                autoComplete="off"
                autoFocus
                disabled={busy}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              autoFocus={mode === "existing"}
              disabled={busy}
            />
          </label>
          {mode === "new" && (
            <>
              <label>
                Senha temporária
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={15}
                  maxLength={1024}
                  autoComplete="new-password"
                  disabled={busy}
                  aria-describedby="member-password-help"
                />
              </label>
              <p id="member-password-help">
                Use de 15 a 1024 caracteres. Entregue as credenciais à pessoa
                por um canal combinado. A troca de senha será obrigatória no
                primeiro acesso pelo login comum. Não há envio de convite nem
                verificação do e-mail informado.
              </p>
            </>
          )}
          {mode === "existing" && (
            <p>
              Informe o e-mail da conta comum existente. Sua senha e seus demais
              vínculos serão preservados.
            </p>
          )}
          <label>
            Papel na organização
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrganizationRole)}
              disabled={busy}
            >
              <RoleOptions />
            </select>
          </label>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy}>
              {busy ? "Salvando…" : "Adicionar usuário"}
            </button>
            <button type="button" disabled={busy} onClick={() => close()}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {selected && (
        <form
          className={styles.editor}
          aria-describedby={error ? "members-error" : undefined}
          aria-label={
            selected.action === "role" ? "Alterar papel" : "Remover vínculo"
          }
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              `/${selected.member.userId}${selected.action === "remove" ? "/remove" : ""}`,
              selected.action === "remove" ? {} : { role },
              selected.action === "remove"
                ? "Vínculo removido desta organização."
                : "Papel atualizado.",
            );
          }}
        >
          <h3>
            {selected.action === "role" ? "Alterar papel" : "Remover vínculo"}:{" "}
            {selected.member.username}
          </h3>
          {selected.action === "role" ? (
            <label>
              Papel na organização
              <select
                autoFocus
                value={role}
                onChange={(e) => setRole(e.target.value as OrganizationRole)}
                disabled={busy}
              >
                <RoleOptions />
              </select>
            </label>
          ) : (
            <p>A conta e os vínculos com outras organizações serão mantidos.</p>
          )}
          <div className={styles.actions}>
            <button autoFocus={selected.action === "remove"} disabled={busy}>
              {busy
                ? "Salvando…"
                : selected.action === "remove"
                  ? "Confirmar remoção"
                  : "Salvar papel"}
            </button>
            <button type="button" disabled={busy} onClick={() => close()}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p className={styles.empty} role="status">
          Carregando usuários…
        </p>
      ) : items.length ? (
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Usuários vinculados"
        >
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>E-mail</th>
                <th>Papel na organização</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <tr key={member.userId}>
                  <th scope="row">{member.username}</th>
                  <td>{member.email}</td>
                  <td>{organizationRoleLabels[member.role]}</td>
                  <td>
                    <div className={styles.actions}>
                      {(["role", "remove"] as const).map((action) => (
                        <button
                          key={action}
                          disabled={editing || busy}
                          aria-label={`${action === "role" ? "Alterar papel de" : "Remover vínculo de"} ${member.username}`}
                          onClick={(e) => {
                            trigger.current = e.currentTarget;
                            setSelected({ member, action });
                            setRole(member.role);
                            setError("");
                            setNotice("");
                          }}
                        >
                          {action === "role"
                            ? "Alterar papel"
                            : "Remover vínculo"}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && (
          <p className={styles.empty}>
            Nenhum usuário vinculado à organização.
          </p>
        )
      )}
    </section>
  );
}
