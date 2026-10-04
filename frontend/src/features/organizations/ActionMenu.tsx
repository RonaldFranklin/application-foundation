"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import styles from "./Organizations.module.css";

// Native disclosure: Enter/Space, Tab, Escape and outside-click dismissal.
export default function ActionMenu({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: "plus" | "pencil";
  disabled?: boolean;
  children: (trigger: HTMLButtonElement | null) => ReactNode;
}) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.menu}>
      <button
        type="button"
        ref={setTrigger}
        disabled={disabled}
        className={styles.menuTrigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={() => {
          const rect = trigger!.getBoundingClientRect();
          const element = panel.current!;
          element.style.left = `${Math.max(8, Math.min(rect.right - 220, innerWidth - 228))}px`;
          element.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 160))}px`;
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          {icon === "plus" ? (
            <path d="M12 5v14M5 12h14" />
          ) : (
            <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" />
          )}
        </svg>
        {icon === "plus" && label}
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        className={styles.menuPanel}
        onToggle={(event) => setOpen(event.newState === "open")}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger
          )
            panel.current?.hidePopover();
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a")) {
            panel.current?.hidePopover();
          }
        }}
      >
        {children(trigger)}
      </div>
    </div>
  );
}
