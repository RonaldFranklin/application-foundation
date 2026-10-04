"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { logout as endSession } from "../services/auth-api";
export default function Logout({
  master,
  compact = false,
  onSelect,
  onFailure,
}: {
  master: boolean;
  compact?: boolean;
  onSelect?: () => void;
  onFailure?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout(forgetDevice = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    onSelect?.();
    try {
      await endSession(forgetDevice);
      router.replace(master ? "/admin/login" : "/login");
      router.refresh();
    } catch {
      setError("Não foi possível sair. Tente novamente.");
      onFailure?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="primary" disabled={busy} onClick={() => logout()}>
        {busy ? "Saindo…" : compact ? "Sair" : "Sair da conta"}
      </button>
      {master && (
        <>
          {!compact && (
            <p className="notice">
              Este navegador é reconhecido por até 30 dias para reduzir
              bloqueios causados por terceiros. Cada acesso continua exigindo
              senha e MFA. Em um dispositivo compartilhado, escolha sair e
              esquecer.
            </p>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => logout(true)}
          >
            Sair e esquecer este dispositivo
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
