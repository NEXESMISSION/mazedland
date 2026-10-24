"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Check, Download } from "lucide-react";

/**
 * « Installer l'app » — the console as an app on the phone or the desktop,
 * one tap, no store.
 *
 * Chrome, Edge and Android announce that a page can be installed with
 * `beforeinstallprompt`; the event is kept (and the browser's own banner
 * held back) so the install starts from this button instead. The admin
 * layout points at /admin.webmanifest, so what gets installed opens on the
 * console, not on the public home page.
 *
 * Safari has no such event: on an iPhone or iPad the button shows the two
 * taps that do it (Partager → Sur l'écran d'accueil). Already installed, or
 * a browser that cannot install: nothing is shown at all.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// One listener for the whole page, so the rail and the mobile bar share the
// event, and it is caught however early it fires.
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

type State = "ready" | "ios" | "hidden";

function readState(): State {
  if (installed) return "hidden";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden";
  if (deferred) return "ready";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "hidden";
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function InstallAppButton({ variant = "row" }: { variant?: "row" | "icon" }) {
  const t = useTranslations("admin.install");
  const state = useSyncExternalStore(subscribe, readState, () => "hidden" as State);
  const [hint, setHint] = useState(false);
  const [done, setDone] = useState(false);

  if (state === "hidden" && !done) return null;

  async function install() {
    if (state === "ios") {
      setHint((h) => !h);
      return;
    }
    const e = deferred;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    // The event can be used once; a dismissed prompt comes back on a later visit.
    deferred = null;
    if (outcome === "accepted") setDone(true);
    emit();
  }

  const label = done ? t("installed") : t("label");
  const Icon = done ? Check : Download;

  if (variant === "icon") {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={install}
          disabled={done}
          aria-label={label}
          title={label}
          className="tap-target grid size-9 place-items-center rounded text-muted transition hover:text-foreground disabled:text-[var(--tone-ok)]"
        >
          <Icon className="size-[18px]" strokeWidth={2.2} />
        </button>
        {hint && (
          <p className="absolute end-0 top-full z-50 mt-1 w-56 rounded-lg bg-surface p-2.5 text-[11.5px] leading-snug text-foreground shadow-lg ring-1 ring-border">
            {t("iosHint")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={install}
        disabled={done}
        className="flex w-full items-center gap-2.5 px-4 py-[7px] text-[12.5px] font-medium text-subtle transition hover:text-foreground disabled:text-[var(--tone-ok)]"
      >
        <Icon className="size-4 shrink-0" strokeWidth={2} />
        {label}
      </button>
      {hint && <p className="px-4 pb-1.5 text-[11px] leading-snug text-muted">{t("iosHint")}</p>}
    </div>
  );
}
