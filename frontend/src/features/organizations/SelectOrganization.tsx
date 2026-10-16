"use client";
import { useState } from "react";
import styles from "./Organizations.module.css";
export default function SelectOrganization({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function select(organizationId: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001"}/v1/organization-context`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Organização indisponível ou vínculo administrativo revogado. Atualize a lista para escolher outra organização."
            : "Não foi possível selecionar a organização. Tente novamente.",
        );
      const selected: { organizationId: string } = await response.json();
      window.dispatchEvent(new Event("organization-context-selection"));
      const channel = new BroadcastChannel("organization-context");
      channel.postMessage("changed");
      channel.close();
      // A full navigation discards the previous organization’s client cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(
        `/organizations/${encodeURIComponent(selected.organizationId)}`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível selecionar a organização.",
      );
      setPending(false);
    }
  }
  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <h1>Selecionar organização</h1>
        <p>Escolha explicitamente a organização que deseja administrar.</p>
      </header>
      <div className={styles.overview}>
        {error && (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={() => window.location.reload()}>
              Atualizar lista
            </button>
          </p>
        )}
        {pending && <p role="status">Selecionando organização…</p>}
        <ul>
          {organizations.map((org) => (
            <li key={org.id}>
              <button disabled={pending} onClick={() => void select(org.id)}>
                Selecionar {org.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
