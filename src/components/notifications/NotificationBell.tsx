"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellDot, X, ShieldCheck, ShieldX, CheckCircle2, AlertTriangle } from "lucide-react";
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
 * Bell icon + dropdown — drops into the TopBar trailing area for
 * authenticated users. Loads the most recent 20 notifications on
 * open, subscribes to realtime inserts for live unread-badge updates,
 * and falls back to a 60s poll if realtime is unavailable.
 *
 * No-ops cleanly for signed-out users (the API returns empty + 0).
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Initial load + 60s poll. Realtime would be nicer here; ship the
  // poll first, layer realtime once we confirm the publication is
  // serving (migration 0023 adds notifications to supabase_realtime).
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Realtime subscription — listens for new rows targeted at this
  // user. We don't filter by user_id at the channel level since the
  // RLS policy on `notifications` already restricts what flows back
  // through the publication, so we just refresh the list on any event.
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

  // Click outside / Escape to dismiss.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        popoverRef.current
        && !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
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

  // Don't render the bell for signed-out users. Distinguish "not
  // signed in" (initial 0/empty) from "signed in, no unread" by
  // waiting for the first refresh — the API returns 0+empty either
  // way, so we render the bell after first load unconditionally and
  // let signed-out users just see an empty dropdown.
  if (!loaded) return null;

  const Icon = unread > 0 ? BellDot : Bell;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--surface-2)] transition-colors"
      >
        <Icon
          className={`h-5 w-5 ${unread > 0 ? "text-[var(--gold)]" : "text-foreground"}`}
          strokeWidth={2}
        />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 mt-2 w-[320px] max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--surface)] shadow-xl ring-1 ring-[var(--border)] overflow-hidden ltr:right-0 rtl:left-0"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-[13px] font-bold text-foreground">
              Notifications
            </h3>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={marking}
                  className="text-[11px] font-bold text-[var(--gold)] hover:text-[var(--gold-bright)]"
                >
                  Tout marquer lu
                </button>
              )}
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[var(--surface-2)]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="px-6 py-10 text-center text-[12px] text-[var(--foreground-muted)]">
              <Bell className="mx-auto mb-2 h-6 w-6 opacity-40" strokeWidth={1.5} />
              Aucune notification pour le moment.
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-[var(--border)] overflow-y-auto">
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
      )}
    </div>
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
    <div className="flex gap-3 px-4 py-3">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}
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
        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
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
          className={`block hover:bg-[var(--surface-2)] ${unread ? "bg-[var(--gold-faint)]/40" : ""}`}
        >
          {content}
        </Link>
      </li>
    );
  }
  return (
    <li
      onClick={onRead}
      className={`cursor-default ${unread ? "bg-[var(--gold-faint)]/40" : ""}`}
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
