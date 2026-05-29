"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Popup } from "@/lib/popups/schema";
import { ModalPopup } from "./ModalPopup";

/**
 * Site-wide popup orchestrator. Mounts once in the locale layout so it
 * runs on every route. Lifecycle:
 *
 *   1. On route change → POST /api/popups/match with the locale-stripped
 *      path + active locale + detected device. Server returns the live
 *      popups that target this surface.
 *   2. For each popup, check the per-user frequency cap (server-driven
 *      via popup_views for logged-in users; localStorage for anon).
 *      Skip anything still capped.
 *   3. Pick the highest-priority survivor per variant slot.
 *      V1 only renders the modal slot.
 *   4. Render the popup, fire an impression event, expose
 *      onDismiss / onClick handlers that POST /api/popups/event.
 *
 * Designed to fail-soft: any network error or unexpected response
 * shape → render nothing rather than blocking the page.
 */

const SESSION_KEY = "batta_popup_session";        // sessionStorage — once_per_session cache
const ANON_DISMISS_KEY = "batta_popup_anon_dismissed"; // localStorage — anon dismissals

/**
 * Strip the leading /:locale segment from a Next-internal path so the
 * matcher sees "/auctions/xyz" and not "/fr/auctions/xyz". The locales
 * are hard-coded to match `routing.locales` — keeping the import out
 * lets PopupManager stay a thin client component.
 */
function stripLocale(path: string): string {
  const m = path.match(/^\/(fr|ar|en)(\/.*)?$/);
  if (!m) return path;
  return m[2] || "/";
}

function detectDevice(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop";
}

export function PopupManager() {
  const rawPath = usePathname();
  const locale = useLocale();
  const router = useRouter();
  const [active, setActive] = useState<Popup | null>(null);

  // Hold a ref to the slug of the popup we're currently showing so the
  // matcher effect can avoid re-firing impressions when the same
  // popup re-qualifies on a quick route change.
  const shownThisMountRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!rawPath) return;
    // Don't run in admin — admins are previewing their own popups via
    // the admin form, surfacing live ones on top would be confusing.
    if (rawPath.startsWith("/admin") || rawPath.match(/^\/(fr|ar|en)\/admin/)) {
      setActive(null);
      return;
    }

    let cancelled = false;
    const path = stripLocale(rawPath);
    const device = detectDevice();

    (async () => {
      try {
        const res = await fetch("/api/popups/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, locale, device }),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: Popup[] };
        if (cancelled) return;

        const candidates = (data.items ?? []).filter((p) => {
          // V1 only renders modal — banner/sheet land in phase 2.
          if (p.variant !== "modal") return false;
          // Anon dismissal — localStorage. Logged-in dismissals are
          // enforced server-side via match_popups (phase 3 will fold
          // popup_views into the matcher; until then, gate client-side
          // so once_per_user actually means once_per_user).
          if (isFrequencyCapped(p)) return false;
          // Don't show the same popup twice in the same client mount
          // (prevents the route-change loop from re-firing).
          if (shownThisMountRef.current.has(p.slug)) return false;
          return true;
        });

        if (candidates.length === 0) {
          setActive(null);
          return;
        }
        const picked = candidates[0]; // RPC already orders by priority desc
        shownThisMountRef.current.add(picked.slug);
        markSession(picked);

        setActive(picked);
        // Fire the impression best-effort; ignore errors so the popup
        // still shows even if /event is briefly unreachable.
        void fetch("/api/popups/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ popup_id: picked.id, kind: "impression" }),
        }).catch(() => undefined);
      } catch {
        // Network/JSON error — render nothing.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawPath, locale]);

  function onDismiss() {
    if (!active) return;
    markDismissed(active);
    void fetch("/api/popups/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ popup_id: active.id, kind: "dismiss" }),
    }).catch(() => undefined);
    setActive(null);
  }

  function onClick(href: string) {
    if (!active) return;
    void fetch("/api/popups/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ popup_id: active.id, kind: "click" }),
    }).catch(() => undefined);
    markDismissed(active); // a click also counts as "don't show again"
    setActive(null);
    // Internal links: stay inside the next-intl router so the locale
    // prefix is preserved. External (http…): full nav.
    if (/^https?:\/\//.test(href)) {
      window.location.href = href;
    } else {
      router.push(href as never);
    }
  }

  if (!active) return null;
  return <ModalPopup popup={active} locale={locale} onDismiss={onDismiss} onClick={onClick} />;
}

// ── Frequency / state helpers ────────────────────────────────────────

/** Has the user already exhausted the popup's frequency cap? */
function isFrequencyCapped(popup: Popup): boolean {
  if (typeof window === "undefined") return false;

  // Anon dismissals live in localStorage keyed by slug. We don't track
  // anon impressions separately because the only frequency cap that
  // makes sense for anon visitors is "I closed it, don't show it
  // again" — every other cadence assumes a user identity.
  const anonDismissed = readJson<string[]>(localStorage, ANON_DISMISS_KEY) ?? [];
  if (anonDismissed.includes(popup.slug)) return true;

  // Session caching — only used for once_per_session. Logged-in users
  // get this on top of their server-tracked once_per_user/N-days cap
  // so we don't pop the same modal on every page in a single session.
  if (popup.frequency === "once_per_session") {
    const seen = readJson<string[]>(sessionStorage, SESSION_KEY) ?? [];
    if (seen.includes(popup.slug)) return true;
  }
  return false;
}

function markSession(popup: Popup) {
  if (typeof window === "undefined") return;
  if (popup.frequency !== "once_per_session") return;
  const seen = readJson<string[]>(sessionStorage, SESSION_KEY) ?? [];
  if (!seen.includes(popup.slug)) {
    writeJson(sessionStorage, SESSION_KEY, [...seen, popup.slug]);
  }
}

function markDismissed(popup: Popup) {
  if (typeof window === "undefined") return;
  // For anon users we always store the slug — there's no server-side
  // record. For logged-in users we also stamp it locally as a hedge
  // against the /event POST failing.
  const dismissed = readJson<string[]>(localStorage, ANON_DISMISS_KEY) ?? [];
  if (!dismissed.includes(popup.slug)) {
    writeJson(localStorage, ANON_DISMISS_KEY, [...dismissed, popup.slug]);
  }
  // Also stamp session so a popup with `every_visit` cadence doesn't
  // re-pop on the very next page after the user clicked through.
  markSession({ ...popup, frequency: "once_per_session" });
}

function readJson<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}
