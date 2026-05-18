"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  BellDot,
  X,
  ShieldCheck,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
  CheckCheck,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const POLL_MS = 60_000;

/**
 * Bell icon + fullscreen modal popup. The bell sits in the TopBar
 * trailing area; tapping it opens a centered overlay (portal) with
 * a gold gradient header and a scrollable list. Realtime + a 60s
 * poll keep the unread badge fresh; signed-out users see nothing.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: NotificationRow[];
        unreadCount: number;
      };
      setItems(data.items);
      setUnread(data.unreadCount);
      setLoaded(true);
    } catch {
      // Network error — silently skip; next poll will retry.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Lock body scroll + Escape-to-close when the modal is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    setUnread(0);
    setItems((arr) =>
      arr.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } finally {
      setMarking(false);
    }
  }

  async function markOneRead(id: string) {
    setItems((arr) =>
      arr.map((n) =>
        n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
      ),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // best-effort
    }
  }

  if (!loaded) return null;

  const Icon = unread > 0 ? BellDot : Bell;

  return (
    <>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--surface-2)] transition-colors"
      >
        <Icon
          className={`h-5 w-5 ${unread > 0 ? "text-[var(--gold)]" : "text-foreground"}`}
          strokeWidth={2}
        />
        {unread > 0 && (
          <span className="absolute top-1 end-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && mounted
        && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[batta-float-up_220ms_ease-out_both]"
              onClick={() => setOpen(false)}
            />

            {/* Dialog card */}
            <div
              ref={dialogRef}
              tabIndex={-1}
              className="relative w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden rounded-3xl bg-[var(--surface)] shadow-[var(--shadow-lg)] ring-1 ring-[var(--border)] focus:outline-none animate-[batta-float-up_300ms_ease-out_both]"
            >
              {/* Gradient header — the favorites-page look */}
              <div className="relative overflow-hidden batta-gradient-gold px-6 py-7 text-white">
                <div
                  aria-hidden
                  className="batta-gradient-blob batta-gradient-blob-sm -top-12 -right-10"
                />
                <div
                  aria-hidden
                  className="batta-gradient-blob batta-gradient-blob-lg -bottom-16 -left-12"
                />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                        <Bell className="h-4 w-4 text-white" strokeWidth={2.2} />
                      </span>
                      <h3 className="text-[18px] font-extrabold tracking-tight text-white">
                        Notifications
                      </h3>
                    </div>
                    <p className="mt-1.5 text-[12px] text-white/85">
                      {unread > 0
                        ? `${unread} non lue${unread > 1 ? "s" : ""}`
                        : "Tout est à jour"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Fermer"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/25"
                  >
                    <X className="h-4 w-4" strokeWidth={2.4} />
                  </button>
                </div>
                {unread > 0 && (
                  <div className="relative mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={markAllRead}
                      disabled={marking}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/25 disabled:opacity-60"
                    >
                      <CheckCheck className="h-3.5 w-3.5" strokeWidth={2.4} />
                      Tout marquer lu
                    </button>
                  </div>
                )}
              </div>

              {/* Body */}
              {items.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--gold-faint)]">
                    <Bell
                      className="h-6 w-6 text-[var(--gold)]"
                      strokeWidth={1.8}
                    />
                  </div>
                  <p className="text-[14px] font-bold text-foreground">
                    Aucune notification pour le moment
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
                    Vous serez prévenu(e) ici dès qu&apos;il y a du nouveau.
                  </p>
                </div>
              ) : (
                <ul className="flex-1 divide-y divide-[var(--border)] overflow-y-auto">
                  {items.map((n) => (
                    <NotificationItem
                      key={n.id}
                      item={n}
                      onRead={() => markOneRead(n.id)}
                      onClose={() => setOpen(false)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function NotificationItem({
  item,
  onRead,
  onClose,
}: {
  item: NotificationRow;
  onRead: () => void;
  onClose: () => void;
}) {
  const unread = !item.read_at;
  const { Icon, tone } = iconForKind(item.kind);

  const content = (
    <div className="flex gap-3 px-5 py-4">
      <span
        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-bold text-foreground leading-tight">
            {item.title}
          </p>
          {unread && (
            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
          )}
        </div>
        {item.body && (
          <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
            {item.body}
          </p>
        )}
        <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
          {timeAgo(item.created_at)}
        </p>
      </div>
    </div>
  );

  if (item.link) {
    return (
      <li>
        <Link
          href={item.link as never}
          onClick={() => {
            onRead();
            onClose();
          }}
          className={`block transition-colors hover:bg-[var(--surface-2)] ${
            unread ? "bg-[var(--gold-faint)]/60" : ""
          }`}
        >
          {content}
        </Link>
      </li>
    );
  }
  return (
    <li
      onClick={onRead}
      className={`cursor-default ${unread ? "bg-[var(--gold-faint)]/60" : ""}`}
    >
      {content}
    </li>
  );
}

function iconForKind(kind: string): {
  Icon: typeof Bell;
  tone: string;
} {
  switch (kind) {
    case "kyc_verified":
      return { Icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" };
    case "kyc_rejected":
      return { Icon: ShieldX, tone: "bg-red-50 text-red-700" };
    case "payment_accepted":
      return { Icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" };
    case "payment_rejected":
      return { Icon: AlertTriangle, tone: "bg-red-50 text-red-700" };
    default:
      return { Icon: Bell, tone: "bg-[var(--gold-faint)] text-[var(--gold)]" };
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}
