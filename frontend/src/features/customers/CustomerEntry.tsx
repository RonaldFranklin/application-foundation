"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { customerRequest } from "./api";
import styles from "./Customers.module.css";
export default function CustomerEntry({
  mode,
}: {
  mode: "login" | "accept" | "forgot" | "reset";
}) {
  const token = useRef("");
  const [stage, setStage] = useState<"login" | "mfa">("login");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (mode === "accept" || mode === "reset") {
      const value = new URLSearchParams(window.location.hash.slice(1)).get(
        "token",
      );
      if (value) token.current = value;
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        const r = await customerRequest<{ stage: string }>(
          stage === "mfa" ? "/mfa/verify" : "/login",
          data,
        );
        form.reset();
        if (r.stage === "full")
          window.location.assign(
            new URL("/customer/account", window.location.origin).href,
          );
        else setStage("mfa");
      } else if (mode === "forgot") {
        const r = await customerRequest<{ message: string }>(
          "/password/request",
          data,
        );
        setNotice(r.message);
        form.reset();
      } else {
        if (!token.current)
          throw new Error("Abra novamente o link recebido por e-mail.");
        await customerRequest(
          mode === "accept" ? "/accept" : "/password/reset",
          { ...data, token: token.current },
        );
        token.current = "";
        form.reset();
        setNotice(
          mode === "accept"
            ? "Conta ativada. Você já pode entrar."
            : "Senha alterada. Entre novamente; seu MFA permanece protegido.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === "accept"
      ? "Ative sua conta"
      : mode === "forgot"
        ? "Recupere sua senha"
        : mode === "reset"
          ? "Defina uma nova senha"
          : stage === "mfa"
            ? "Confirme seu acesso"
            : "Entre na sua conta";
  return (
    <main className={styles.page}>
      <Link href="/customer/login">Application Foundation · Clientes</Link>
      <h1>{title}</h1>
      <section className={styles.card}>
        {notice ? (
          <p role="status">{notice}</p>
        ) : (
          <form onSubmit={submit} aria-busy={busy}>
            {(mode === "forgot" || (mode === "login" && stage === "login")) && (
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
            )}
            {mode === "accept" && (
              <label>
                Nome de exibição
                <input
                  name="name"
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
            )}
            {mode !== "forgot" && stage !== "mfa" && (
              <label>
                {mode === "login"
                  ? "Senha"
                  : "Nova senha (mínimo de 15 caracteres)"}
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "login" ? undefined : 15}
                  maxLength={1024}
                  required
                />
              </label>
            )}
            {(mode === "accept" || mode === "reset") && (
              <label>
                Confirme a senha
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={1024}
                  required
                />
              </label>
            )}
            {mode === "login" && stage === "mfa" && (
              <label>
                Código do autenticador ou de recuperação
                <input
                  name="code"
                  autoComplete="one-time-code"
                  maxLength={64}
                  required
                />
              </label>
            )}
            <button disabled={busy}>
              {busy
                ? "Aguarde…"
                : mode === "forgot"
                  ? "Enviar instruções"
                  : mode === "login"
                    ? "Entrar"
                    : "Salvar"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </section>
      <div className={styles.actions}>
        <Link href="/customer/login">Login de cliente</Link>
        {mode === "login" && (
          <Link href="/customer/forgot">Esqueci minha senha</Link>
        )}
      </div>
    </main>
  );
}
