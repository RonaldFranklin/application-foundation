"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import Shell from "@/components/layout/Shell";
import { useAuthFlow } from "../hooks/useAuthFlow";
import { SITE_KEY } from "../hooks/useTurnstile";
import { CredentialFields } from "./CredentialFields";
import { MfaFields } from "./MfaFields";
import { RecoveryCodes } from "./RecoveryCodes";
export default function Login({
  master = false,
  nonce,
}: {
  master?: boolean;
  nonce?: string;
}) {
  const {
    stage,
    busy,
    error,
    secret,
    codes,
    challenge,
    captcha,
    setScriptReady,
    challengeRef,
    submit,
    loadSecret,
    restart,
  } = useAuthFlow(master);
  const [show, setShow] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage !== "login") title.current?.focus();
  }, [stage]);
  const heading =
    stage === "login"
      ? "Bem-vindo de volta."
      : stage === "password"
        ? "Uma senha só sua."
        : stage === "setup"
          ? "Proteja seu acesso."
          : stage === "mfa"
            ? "Confirme que é você."
            : "Guarde seus códigos.";
  return (
    <Shell master={master}>
      <div className="eyebrow">
        <span className="status-dot" />
        {master ? "ACESSO MASTER" : "SEU ESPAÇO. SUA EVOLUÇÃO."}
      </div>
      <h1 ref={title} tabIndex={-1}>
        {heading}
      </h1>
      <p className="subtitle">
        {stage === "login"
          ? "Entre com suas credenciais para continuar."
          : stage === "password"
            ? master
              ? "Crie uma nova senha com pelo menos 15 caracteres."
              : "Sua senha é temporária. Crie e confirme uma nova senha de 15 a 1024 caracteres para acessar sua conta."
            : stage === "setup"
              ? "Adicione a chave ao seu aplicativo autenticador e confirme o código."
              : stage === "mfa"
                ? "Use o código do autenticador ou um código de recuperação."
                : "Cada código pode ser usado uma única vez. Salve-os em um lugar seguro."}
      </p>
      <form key={stage} onSubmit={submit} aria-busy={busy}>
        <CredentialFields
          stage={stage}
          confirmPassword={!master}
          error={error}
          show={show}
          setShow={setShow}
        />
        <MfaFields
          stage={stage}
          error={error}
          secret={secret}
          busy={busy}
          loadSecret={loadSecret}
        />
        {stage === "recovery" && <RecoveryCodes codes={codes} />}
        {challenge && stage === "login" && (
          <div className="challenge">
            {SITE_KEY ? (
              <>
                <Script
                  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                  nonce={nonce}
                  onReady={() => setScriptReady(true)}
                />
                <div ref={challengeRef} />
              </>
            ) : (
              <p>
                Verificação adicional necessária. O administrador precisa
                configurar o Turnstile neste ambiente.
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="error" id="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={
            busy ||
            (stage === "setup" && !secret) ||
            (stage === "login" && challenge && !captcha)
          }
          type="submit"
        >
          {busy
            ? "Aguarde…"
            : stage === "login"
              ? "Entrar"
              : stage === "password"
                ? "Salvar nova senha"
                : stage === "recovery"
                  ? "Concluir e continuar"
                  : "Verificar código"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      {stage === "login" ? (
        <>
          <div className="divider">
            <span>ou continue com</span>
          </div>
          <div className="social">
            <button disabled type="button" aria-label="Google — em breve">
              <b aria-hidden="true">G</b>Google<span>Em breve</span>
            </button>
            <button disabled type="button" aria-label="Apple — em breve">
              <b aria-hidden="true">●</b>Apple<span>Em breve</span>
            </button>
          </div>
          <p className="privacy">
            Seu foco no que importa.
            <br />
            Seu acesso protegido, sempre.
          </p>
          <a className="switch-flow" href={master ? "/login" : "/admin/login"}>
            {master ? "Acesso de usuário" : "Acesso master"}{" "}
            <span aria-hidden="true">↗</span>
          </a>
        </>
      ) : (
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={restart}
        >
          Sair e voltar ao login
        </button>
      )}
    </Shell>
  );
}
