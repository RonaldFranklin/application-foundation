"use client";
import { useEffect, useRef, useState } from "react";
export const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}
export function useTurnstile(challenge: boolean) {
  const [captcha, setCaptcha] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const challengeRef = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !challenge ||
      !scriptReady ||
      !challengeRef.current ||
      !window.turnstile
    )
      return;
    widget.current = window.turnstile.render(challengeRef.current, {
      sitekey: SITE_KEY,
      action: "master-login",
      theme: "dark",
      callback: (value: string) => setCaptcha(value),
      "expired-callback": () => setCaptcha(""),
      "error-callback": () => setCaptcha(""),
    });
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [challenge, scriptReady]);
  function resetCaptcha() {
    setCaptcha("");
    if (widget.current) window.turnstile?.reset(widget.current);
  }
  return { captcha, setScriptReady, challengeRef, resetCaptcha };
}
