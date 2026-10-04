"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Stage } from "../types/auth";
import {
  authRequest,
  AuthRequestError,
  readSession,
} from "../services/auth-api";
import { useTurnstile } from "./useTurnstile";
export function useAuthFlow(master: boolean) {
  const router = useRouter();
  const submitting = useRef(false);
  const [stage, setStage] = useState<Stage>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [challenge, setChallenge] = useState(false);
  const { captcha, setScriptReady, challengeRef, resetCaptcha } =
    useTurnstile(challenge);
  const request = useCallback(async (path: string, body?: object) => {
    try {
      return await authRequest(path, body);
    } catch (error) {
      if (error instanceof AuthRequestError && error.challengeRequired)
        setChallenge(true);
      throw error;
    }
  }, []);
  useEffect(() => {
    let active = true;
    readSession()
      .then((s) => {
        if (!active) return;
        if (s.master !== master) return;
        if (s.stage === "full") {
          router.replace(master ? "/admin" : "/");
          return;
        }
        setStage(s.stage);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [request, master, router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      stage === "password" &&
      !master &&
      values.get("password") !== values.get("confirmPassword")
    ) {
      setError("A confirmação deve coincidir com a nova senha.");
      form.reset();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      let data;
      if (stage === "login")
        data = await request(`${master ? "admin/" : ""}auth/login`, {
          identifier: values.get("identifier"),
          password: values.get("password"),
          ...(captcha ? { turnstileToken: captcha } : {}),
        });
      else if (stage === "password")
        data = await request(
          master ? "admin/auth/password" : "auth/initial-password",
          {
            password: values.get("password"),
            ...(!master
              ? { confirmPassword: values.get("confirmPassword") }
              : {}),
          },
        );
      else if (stage === "setup")
        data = await request("admin/auth/totp/enroll", {
          code: values.get("code"),
        });
      else if (stage === "mfa")
        data = await request("admin/auth/mfa", { code: values.get("code") });
      else data = await request("admin/auth/confirm", {});
      if (data.recoveryCodes) setCodes(data.recoveryCodes);
      if (data.stage === "full") {
        router.replace(master ? "/admin" : "/");
        router.refresh();
      } else if (data.stage) setStage(data.stage);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha de conexão. Tente novamente.",
      );
    } finally {
      if (stage === "password") form.reset();
      submitting.current = false;
      setBusy(false);
      resetCaptcha();
    }
  }
  async function loadSecret() {
    setBusy(true);
    setError("");
    try {
      const data = await request("admin/auth/totp/setup", {});
      setSecret(data.secret!);
    } catch {
      setError(
        "Não foi possível configurar. Entre novamente se sua sessão expirou.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restart() {
    setBusy(true);
    try {
      await request("auth/logout", {});
      setStage("login");
      setSecret("");
      setCodes([]);
      setError("");
    } catch {
      setError("Não foi possível sair. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return {
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
  };
}
