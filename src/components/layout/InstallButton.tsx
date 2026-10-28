"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * « Installer l'app » — the site, or the console, as an app on the phone or
 * the desktop: one tap, no store.
 *
 * Chrome, Edge and Android announce that a page can be installed with
 * `beforeinstallprompt`; the event is kept (and the browser's own banner held
 * back) so the install starts from this button instead. Which app gets
 * installed is the page's manifest: the console points at /admin.webmanifest
 * and opens on the console, the public pages at /manifest.webmanifest.
 *
 * Without that event the button stays, as a way to do it by hand: on an
 * iPhone or iPad the two taps (Partager → Sur l'écran d'accueil), elsewhere
 * the browser menu. Already installed (opened as the app): nothing is shown.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// One listener for the whole page, so every button shares the event, and it
// is caught however early it fires.
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

/** ready: the browser installs on a tap · ios / manual: the steps by hand · hidden: already the app. */
export type InstallState = "ready" | "ios" | "manual" | "hidden";

function readState(): InstallState {
  if (installed) return "hidden";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden";
  if (deferred) return "ready";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "manual";
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function InstallButton({
  scope,
  variant = "row",
  className,
}: {
  /** Whose texts: the console's (« admin.install ») or the public site's (« install »). */
  scope: "admin" | "site";
  variant?: "row" | "icon";
  className?: string;
}) {
  const ta = useTranslations("admin.install");
  const ts = useTranslations("install");
  const t = (k: "label" | "installed" | "iosHint" | "manualHint") => (scope === "admin" ? ta(k) : ts(k));
  const state = useSyncExternalStore(subscribe, readState, () => "hidden" as InstallState);
  const [hint, setHint] = useState(false);
  const [done, setDone] = useState(false);

  if (state === "hidden" && !done) return null;

  async function install() {
    if (state === "ios" || state === "manual") {
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
  const how = state === "ios" ? t("iosHint") : t("manualHint");

  if (variant === "icon") {
    return (
      <div className={cn("relative", className)}>
        <button
          type="button"
          onClick={install}
          disabled={done}
          aria-label={label}
          aria-expanded={state !== "ready" ? hint : undefined}
          title={label}
          className="tap-target grid size-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground disabled:text-[var(--tone-ok)]"
        >
          <Icon className="size-[18px]" strokeWidth={2.2} />
        </button>
        {hint && (
          <p role="status" className="absolute end-0 top-full z-50 mt-1 w-64 rounded-lg bg-surface p-2.5 text-[11.5px] leading-snug text-foreground shadow-lg ring-1 ring-border">
            {how}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={install}
        disabled={done}
        aria-expanded={state !== "ready" ? hint : undefined}
        className="flex w-full items-center gap-2.5 px-4 py-[7px] text-[12.5px] font-medium text-subtle transition hover:text-foreground disabled:text-[var(--tone-ok)]"
      >
        <Icon className="size-4 shrink-0" strokeWidth={2} />
        {label}
      </button>
      {hint && <p role="status" className="px-4 pb-1.5 text-[11px] leading-snug text-muted">{how}</p>}
    </div>
  );
}
