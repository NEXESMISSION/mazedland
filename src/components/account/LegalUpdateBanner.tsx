"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { getWatchlistState, subscribeWatchlist } from "@/lib/watchlistStore";

const ANSWERED = "mazed-legal-ok";

function readAnswered(): boolean {
  try {
    return sessionStorage.getItem(ANSWERED) === "1";
  } catch {
    return false;
  }
}

function rememberAnswered() {
  try {
    sessionStorage.setItem(ANSWERED, "1");
  } catch {
    /* private window: asked again on the next page, which is harmless */
  }
}

/**
 * Asks a signed-in person to accept the CGU and privacy policy in force
 * (0182) when they never did — accounts made before consents were recorded —
 * or when an admin changed `legal_version`. A bar at the top of the page,
 * under the header (MobileShell), not a wall: the site keeps working, the
 * bar stays until they answer. Not on the signup and login screens.
 *
 * Waits for the login state the favourites store already fetches on every
 * page, then asks /api/account/consents once per browser session.
 */
export function LegalUpdateBanner() {
  const t = useTranslations("legalUpdate");
  const auth = useSyncExternalStore(subscribeWatchlist, getWatchlistState, getWatchlistState);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!auth.hydrated || !auth.loggedIn || readAnswered()) return;
    let live = true;
    fetch("/api/account/consents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { needsLegal?: boolean; version?: string } | null) => {
        if (!live || !d) return;
        if (d.needsLegal && d.version) setVersion(d.version);
        else rememberAnswered();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [auth.hydrated, auth.loggedIn]);

  if (!version) return null;

  async function accept() {
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/account/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept: true }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    rememberAnswered();
    setVersion(null);
  }

  return (
    <div role="region" aria-label={t("label")} className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-x-4 gap-y-2 px-4 py-2.5">
        <p className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold" />
          <span>
            {t.rich("body", {
              // Isolated: « 2026-10 » reads « 10-2026 » in an Arabic sentence otherwise.
              version: `\u2066${version}\u2069`,
              terms: (chunks) => <Link href={"/terms" as never} className="font-bold text-gold hover:underline">{chunks}</Link>,
              privacy: (chunks) => <Link href={"/privacy" as never} className="font-bold text-gold hover:underline">{chunks}</Link>,
            })}
            {failed && <span role="alert" className="ms-1 font-semibold text-[var(--tone-bad)]">{t("failed")}</span>}
          </span>
        </p>
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="mazed-btn-luxe tap-target inline-flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("accept")}
        </button>
      </div>
    </div>
  );
}
