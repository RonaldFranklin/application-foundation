"use client";
import { useState, useRef } from "react";
import styles from "./Profile.module.css";
import { authRequest } from "../services/auth-api";
export default function EnableMfa({
  administrative,
}: {
  administrative: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <div className={styles.editor}>
      <p className={styles.hint}>
        Você pode ativar MFA para proteger os próximos acessos.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await authRequest("auth/mfa/start", {});
            window.location.assign(administrative ? "/admin/login" : "/login");
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Não foi possível iniciar a configuração.",
            );
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Iniciando…" : "Configurar MFA"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
