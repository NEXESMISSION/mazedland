"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  User, Activity, Receipt, Heart, ClipboardCheck, ShieldCheck, Plus,
  LogOut, Loader2,
} from "lucide-react";

type Item = { href: string; label: string; Icon: typeof User };

const ITEMS: Item[] = [
  { href: "/account", label: "Mon compte", Icon: User },
  { href: "/account/activity", label: "Mon activité", Icon: Activity },
  { href: "/account/payments", label: "Mes paiements", Icon: Receipt },
  { href: "/account/watchlist", label: "Favoris", Icon: Heart },
  { href: "/account/inspections", label: "Inspections", Icon: ClipboardCheck },
  { href: "/kyc/status", label: "Vérification (KYC)", Icon: ShieldCheck },
  { href: "/sell", label: "Vendre un bien", Icon: Plus },
];

/**
 * Desktop account control in the header. For signed-in users the avatar
 * opens a dropdown with every account destination + a sign-out shortcut
 * (clears the Supabase session, then hard-redirects to the localized login
 * page). For guests it's just a "Connexion" link.
 */
export function AccountMenu() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Resolve auth state once + keep it in sync.
  useEffect(() => {
    const sb = getBrowserSupabase();
    let active = true;
    sb.auth.getUser().then((res: { data: { user: unknown } }) => {
      if (active) setAuthed(!!res.data.user);
    });
    const { data: sub } = sb.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (active) setAuthed(!!session?.user);
      },
    );
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // APG: return focus to the trigger on close
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // APG menu keyboard support: move focus into the menu on open, and let
  // Arrow/Home/End rove between items (they're also Tab-reachable).
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[0]?.focus();
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const locale = window.location.pathname.split("/")[1] || "fr";
    try {
      const sb = getBrowserSupabase();
      await Promise.all([
        sb.auth.signOut(),
        fetch("/api/auth/signout", { method: "POST", headers: { Accept: "application/json" } }),
      ]);
    } finally {
      window.location.href = `/${locale}/login`;
    }
  }

  // Guest → plain login link (matches the avatar footprint).
  if (authed === false) {
    return (
      <Link
        href="/login"
        aria-label="Connexion"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold text-muted transition-colors hover:border-gold-soft/60 hover:text-foreground"
      >
        <User className="size-4.5" strokeWidth={2} />
        Connexion
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mon compte"
        className={`inline-flex size-10 items-center justify-center rounded-full border transition-colors ${
          open
            ? "border-gold-soft bg-gold-faint text-gold"
            : "border-border text-muted hover:border-gold-soft/60 hover:text-foreground"
        }`}
      >
        <User className="size-5" strokeWidth={2} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Mon compte"
          onKeyDown={onMenuKey}
          className="absolute end-0 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-[0_20px_50px_-18px_rgba(0,0,0,0.45)]"
        >
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href as "/account"}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-foreground/85 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <it.Icon className="size-4 shrink-0 text-muted" strokeWidth={2} />
              {it.label}
            </Link>
          ))}

          <div aria-hidden className="my-1 h-px bg-border" />

          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            {loggingOut ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <LogOut className="size-4 shrink-0" strokeWidth={2.2} />}
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
