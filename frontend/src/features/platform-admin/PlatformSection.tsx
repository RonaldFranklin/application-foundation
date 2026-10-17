"use client";
import { useState } from "react";
import PlatformAdmins from "./PlatformAdmins";
import PlatformRoles from "./PlatformRoles";
import styles from "./PlatformAdmins.module.css";
export default function PlatformSection() {
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Administração da plataforma"
      >
        {["Contas e convites", "Cargos e permissões"].map((label, index) => (
          <button
            key={label}
            id={`platform-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={tab === index}
            aria-controls={`platform-panel-${index}`}
            tabIndex={tab === index ? 0 : -1}
            disabled={busy}
            onClick={() => setTab(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 1
                    : ["ArrowLeft", "ArrowRight"].includes(event.key)
                      ? 1 - index
                      : null;
              if (next === null || busy) return;
              event.preventDefault();
              setTab(next);
              document.getElementById(`platform-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={styles.tabPanel}
        id={`platform-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`platform-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 0 ? (
          <PlatformAdmins onBusyChange={setBusy} />
        ) : (
          <PlatformRoles onBusyChange={setBusy} />
        )}
      </div>
    </>
  );
}
