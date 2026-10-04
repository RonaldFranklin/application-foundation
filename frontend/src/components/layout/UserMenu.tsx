"use client";
import { useRef, useState } from "react";
import type { AccountProfile } from "@/features/auth/types/profile";
import Logout from "@/features/auth/components/Logout";
import styles from "./AuthenticatedShell.module.css";

export default function UserMenu({
  profile,
  settingsActive,
}: {
  profile: AccountProfile;
  settingsActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const master = profile.accountType === "master";
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className={styles.user}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className={styles.userButton}
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="account-options"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {Array.from(profile.username.trim())[0]?.toLocaleUpperCase("pt-BR") ||
            "G"}
        </span>
        <span className={styles.userName}>
          {profile.username}
          <small>Menu da conta</small>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div className={styles.userOptions} id="account-options" hidden={!open}>
        <a
          href={master ? "/admin/settings" : "/settings"}
          aria-current={settingsActive ? "page" : undefined}
          onClick={close}
        >
          Configurações da conta
        </a>
        <Logout
          master={master}
          compact
          onSelect={close}
          onFailure={() => setOpen(true)}
        />
      </div>
    </div>
  );
}
