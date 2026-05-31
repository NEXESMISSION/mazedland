"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  BellDot,
  X,
  Trash2,
  CheckCheck,
  MoreHorizontal,
  ShieldCheck,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
  Gavel,
  TrendingUp,
  Trophy,
  Clock3,
  Eye,
  HandCoins,
  FileCheck2,
  CalendarClock,
  ClipboardList,
  Sparkles,
  Wallet,
  Hourglass,
  UserCheck,
  FileText,
  Megaphone,
  Inbox,
  Radio,
  Receipt,
  Timer,
  TimerReset,
  CircleAlert,
  // Added: distinct glyphs for the 6 kinds previously falling through to
  // the generic Bell icon — broadcasts (announcement / promo / maintenance
  // / system_alert) and entity-tied lifecycle events (auction_cancelled,
  // deposit_refunded). A bell that visually distinguishes "your auction
  // was cancelled" from "your deposit was refunded" is the whole point.
  Tag,
  Wrench,
  ShieldAlert,
  Ban,
  RefreshCcw,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { resolveNotificationLink } from "@/lib/notifications/target";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  /** Optional structured context from the creator — e.g. { focus: <row_id> }
   *  for list-page deep links, or sender-supplied broadcast metadata. */
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const POLL_MS = 60_000;
// Re-render relative timestamps every 30s while the dialog is open so
// "il y a 1 min" doesn't freeze.
const TICK_MS = 30_000;

/**
 * Kinds that get a small "URGENT" pill — the user has a narrow window
 * to act before they lose money / a property / a verification. The
 * pill is a one-element visual marker on the same row shape as
 * everything else, so the list stays uniform (no two-tier split).
 */
const URGENT_KINDS = new Set<string>([
  "outbid",
  "sixth_offer_outbid",
  "auction_ending_soon",
  "auction_cancelled",
  // Symmetric with due_tomorrow / overdue — the soon→tomorrow→overdue
  // arc is the user's only warning before they lose their winning bid.
  "final_payment_due_soon",
  "final_payment_due_tomorrow",
  "final_payment_overdue",
  "final_payment_overdue_seller",
  "kyc_rejected",
  "listing_rejected",
  "listing_payment_rejected",
  // Financial-loss kinds the user has to react to — without the urgent
  // pill the row just sits in the list and the user misses why their
  // payout never landed or their payment was refused.
  "payment_rejected",
  "payout_rejected",
]);

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [, setTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
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

  // Realtime INSERT channel + reset on user change.
  //
  // Critical: the channel is filtered to user_id = caller. Without the
  // filter, every INSERT in public.notifications fires this listener —
  // so a broadcast to N users triggers N concurrent refresh() calls on
  // this bell, each of which hits /api/notifications → getUser() →
  // potential token refresh. Many parallel token refreshes race on
  // Supabase's refresh-token reuse detection and the session gets
  // revoked. That's the "logged out after broadcasting" bug.
  //
  // Tearing down on SIGNED_OUT also prevents a stale subscription
  // leaking a previous user's badge into the next session.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // Unique per mount. React strict-mode double-invokes effects (and a
    // fast unmount/remount can too); reusing a fixed channel name returns
    // the previous, still-subscribed channel from supabase's registry, and
    // calling `.on()` on it throws "cannot add postgres_changes callbacks
    // after subscribe()". A fresh name each mount sidesteps that race while
    // the cleanup below still removes whichever channel this run created.
    const channelKey = `notifications-bell-${Math.random().toString(36).slice(2, 10)}`;

    // Inline debounce — kept inside the effect so it shares its
    // lifecycle and can't outlive the subscription it serves. 250ms
    // coalesces bursts (e.g. an INSERT immediately followed by a
    // navigation-triggered re-render).
    let refreshTimer: number | null = null;
    function scheduleRefresh() {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 250);
    }

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      channel = supabase
        .channel(channelKey)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        // UPDATE → catches mark-as-read from another tab (the badge
        // here would otherwise stay stale until the next 60s poll) and
        // DELETE → catches a row removed elsewhere (admin bulk-delete,
        // self-clear from another device). We share the same debounce
        // so a burst of events still only triggers one /api/notifications
        // round-trip.
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        .subscribe();
    })();

    const sub = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_OUT") {
        setItems([]);
        setUnread(0);
        setOpen(false);
        setMenuOpen(false);
        setConfirmingDeleteAll(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      sub.data.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setConfirmingDeleteAll(false);
      return;
    }
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

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function markAllRead() {
    if (unread === 0) return;
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
    } catch {
      // best-effort
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

  // Delete = optimistic → roll back ONLY if the server confirmed 0 rows
  // deleted or the network call failed. We no longer refresh() in the
  // finally block; the refresh was overwriting the optimistic state
  // with whatever the server still had, which masked the symptom
  // ("item came back after I deleted it") of a silent zero-row DELETE.
  async function deleteOne(id: string) {
    const snapshot = { items, unread };
    const wasUnread = items.find((n) => n.id === id && !n.read_at);
    setItems((arr) => arr.filter((n) => n.id !== id));
    if (wasUnread) setUnread((n) => Math.max(0, n - 1));
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("delete_failed");
      const deletedCount = (payload as { deletedCount?: number }).deletedCount;
      if (typeof deletedCount === "number" && deletedCount === 0) {
        setItems(snapshot.items);
        setUnread(snapshot.unread);
        toast("Suppression refusée par le serveur.", "error");
      }
    } catch {
      setItems(snapshot.items);
      setUnread(snapshot.unread);
      toast("Échec de la suppression. Vérifiez la connexion.", "error");
    }
  }

  async function deleteAll() {
    if (items.length === 0) return;
    const snapshot = { items, unread };
    setItems([]);
    setUnread(0);
    setConfirmingDeleteAll(false);
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("delete_failed");
      const deletedCount = (payload as { deletedCount?: number }).deletedCount;
      if (typeof deletedCount === "number" && deletedCount === 0) {
        setItems(snapshot.items);
        setUnread(snapshot.unread);
        toast("Suppression refusée par le serveur.", "error");
      } else if (typeof deletedCount === "number") {
        toast(
          `${deletedCount} notification${deletedCount > 1 ? "s" : ""} supprimée${deletedCount > 1 ? "s" : ""}.`,
          "success",
        );
      }
    } catch {
      setItems(snapshot.items);
      setUnread(snapshot.unread);
      toast("Échec de la suppression. Vérifiez la connexion.", "error");
    }
  }

  if (!loaded) return null;

  const BellIcon = unread > 0 ? BellDot : Bell;

  return (
    <>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--surface-2)] transition-colors"
      >
        <BellIcon
          className={`h-5 w-5 ${unread > 0 ? "text-[var(--gold)]" : "text-foreground"}`}
          strokeWidth={2}
        />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -end-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-[5px] text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)] batta-tabular"
            aria-label={`${unread} non lues`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && mounted
        && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 lg:items-start lg:justify-end lg:p-0"
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
          >
            {/* Backdrop — dark sheet on mobile; on desktop it's invisible
                (just a click-catcher) so the panel reads as a header dropdown,
                not a modal over a dimmed page. */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[batta-float-up_180ms_ease-out_both] lg:bg-transparent lg:backdrop-blur-none lg:animate-none"
              onClick={() => setOpen(false)}
            />

            <div
              className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-[var(--surface)] shadow-[var(--shadow-lg)] ring-1 ring-[var(--border)] focus:outline-none animate-[batta-float-up_240ms_ease-out_both] lg:absolute lg:end-6 lg:top-[calc(var(--desktop-nav-h)-0.25rem)] lg:max-h-[72vh] lg:w-[400px] lg:rounded-2xl"
            >
              {/* Header — restored gold accent (top stripe + tinted chip)
                  without the full-bleed gradient blob that was eating
                  attention away from the list. */}
              <div className="relative px-5 pt-5 pb-3">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px] batta-gradient-gold"
                />
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl batta-gradient-gold shadow-[var(--shadow-gold)]">
                    <Bell className="h-4 w-4 text-white" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-extrabold tracking-tight text-foreground leading-tight">
                      Notifications
                    </h3>
                    <p className="text-[11px] font-medium text-[var(--foreground-muted)] leading-tight mt-0.5">
                      {unread > 0
                        ? `${unread} non lue${unread > 1 ? "s" : ""}`
                        : "Tout est à jour"}
                    </p>
                  </div>

                  {items.length > 0 && (
                    <div ref={menuRef} className="relative">
                      <button
                        type="button"
                        aria-label="Actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((v) => !v)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      >
                        <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                      </button>
                      {menuOpen && (
                        <div
                          role="menu"
                          className="absolute z-10 mt-1 w-56 origin-top rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl ltr:right-0 ltr:origin-top-right rtl:left-0 rtl:origin-top-left"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            disabled={unread === 0}
                            onClick={() => {
                              void markAllRead();
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-[13px] font-semibold text-foreground hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:bg-[var(--surface-2)] focus-visible:outline-none"
                          >
                            <CheckCheck className="h-4 w-4 text-[var(--gold)]" strokeWidth={2} />
                            Tout marquer lu
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setConfirmingDeleteAll(true);
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-[13px] font-semibold text-foreground hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:outline-none"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                            Supprimer tout
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    aria-label="Fermer"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    <X className="h-4 w-4" strokeWidth={2.4} />
                  </button>
                </div>
              </div>

              {confirmingDeleteAll && (
                <div className="mx-5 mb-3 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
                  <span className="font-semibold">Tout supprimer ?</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteAll(false)}
                      className="rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-900 hover:bg-red-100"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAll()}
                      className="rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700"
                    >
                      Confirmer
                    </button>
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--gold-faint)]">
                    <Bell className="h-6 w-6 text-[var(--gold)]" strokeWidth={1.8} />
                  </div>
                  <p className="text-[14px] font-bold text-foreground">
                    Aucune notification
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
                    Tout est calme. Allez jeter un œil aux enchères.
                  </p>
                  <Link
                    href="/properties"
                    onClick={() => setOpen(false)}
                    className="mt-5 inline-flex items-center gap-1.5 rounded-full batta-gold-fill px-4 py-2 text-[12px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]"
                  >
                    Explorer les enchères
                  </Link>
                </div>
              ) : (
                <ul className="flex-1 divide-y divide-[var(--border)] overflow-y-auto">
                  {items.map((n) => (
                    <NotificationRow
                      key={n.id}
                      item={n}
                      onRead={() => markOneRead(n.id)}
                      onDelete={() => deleteOne(n.id)}
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

const SWIPE_REVEAL_PX = 80;
const SWIPE_THRESHOLD_PX = 40;

/**
 * Single uniform row used for every notification, urgent or otherwise.
 * Urgency is conveyed by a small red "URGENT" pill next to the title
 * (only on unread items in URGENT_KINDS); read items hide the pill
 * because the user has already seen the urgency. Body text is always
 * visible (max 2 lines) so the user gets enough context to decide
 * whether to act, without expanding the row to a card.
 */
function NotificationRow({
  item,
  onRead,
  onDelete,
  onClose,
}: {
  item: NotificationRow;
  onRead: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const unread = !item.read_at;
  const { Icon, tone } = iconForKind(item.kind);
  const isUrgent = unread && URGENT_KINDS.has(item.kind);
  const href = resolveNotificationLink(item.kind, item.link, item.payload);

  const [dragPx, setDragPx] = useState(0);
  const [snapped, setSnapped] = useState(false);
  const pointerStartX = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const isRTL = typeof document !== "undefined"
    && document.documentElement.getAttribute("dir") === "rtl";
  const direction = isRTL ? 1 : -1;

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return; // swipe is mobile-only
    pointerStartX.current = e.clientX;
    pointerId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointerStartX.current === null) return;
    if (pointerId.current !== e.pointerId) return;
    const raw = e.clientX - pointerStartX.current;
    const reveal = raw * direction;
    const clamped = Math.max(0, Math.min(SWIPE_REVEAL_PX, reveal));
    setDragPx(clamped * direction);
  }

  function onPointerUp() {
    pointerStartX.current = null;
    pointerId.current = null;
    if (Math.abs(dragPx) >= SWIPE_THRESHOLD_PX) {
      setDragPx(SWIPE_REVEAL_PX * direction);
      setSnapped(true);
    } else {
      setDragPx(0);
      setSnapped(false);
    }
  }

  function resetSwipe() {
    setDragPx(0);
    setSnapped(false);
  }

  function onClickCapture(e: React.MouseEvent) {
    if (snapped) {
      e.preventDefault();
      e.stopPropagation();
      resetSwipe();
    }
  }

  const inner = (
    <div className="group/row relative flex gap-3 px-5 py-3.5">
      {/* Tiny gold dot — single signal for "unread". No stripe / bg /
          pulsing. Stays out of the row flow. */}
      <span
        aria-hidden
        className={`absolute start-2 top-5 inline-block h-1.5 w-1.5 rounded-full ${
          unread ? "bg-[var(--gold)]" : "bg-transparent"
        }`}
      />
      <span
        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone} ${
          unread ? "" : "opacity-60"
        }`}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p
            className={`text-[13px] leading-tight ${
              unread
                ? "font-extrabold text-foreground"
                : "font-semibold text-[var(--foreground-muted)]"
            }`}
          >
            {item.title}
          </p>
          {isUrgent && (
            <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white leading-none mt-0.5">
              Urgent
            </span>
          )}
        </div>
        {item.body && (
          <p
            className={`mt-1 text-[12px] leading-snug line-clamp-2 ${
              unread ? "text-foreground/80" : "text-[var(--foreground-muted)]"
            }`}
          >
            {item.body}
          </p>
        )}
        <p className="mt-1.5 text-[10px] font-medium text-[var(--foreground-muted)]">
          {timeAgo(item.created_at)}
        </p>
      </div>
      {/* Hover-revealed × on desktop (44pt tap target). Hidden by
          default so the row stays uncluttered; swipe handles mobile. */}
      <button
        type="button"
        aria-label="Supprimer"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] opacity-0 transition group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        <X className="h-4 w-4" strokeWidth={2.4} />
      </button>
    </div>
  );

  return (
    <li className="relative overflow-hidden">
      {/* Swipe-reveal red tray underneath; pointer events let the user
          also tap it once it's revealed. */}
      <button
        type="button"
        aria-label="Supprimer"
        onClick={() => {
          resetSwipe();
          onDelete();
        }}
        className="absolute inset-y-0 end-0 flex w-20 items-center justify-center bg-red-600 text-white"
      >
        <Trash2 className="h-5 w-5" strokeWidth={2.2} />
      </button>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{
          transform: `translate3d(${dragPx}px, 0, 0)`,
          transition: pointerStartX.current === null ? "transform 200ms ease-out" : "none",
          touchAction: "pan-y",
        }}
        className="relative bg-[var(--surface)]"
      >
        {href ? (
          <Link
            href={href as never}
            onClick={() => {
              onRead();
              onClose();
            }}
            className="block transition-colors hover:bg-[var(--surface-2)]"
          >
            {inner}
          </Link>
        ) : (
          <div
            onClick={onRead}
            className="cursor-default hover:bg-[var(--surface-2)] transition-colors"
          >
            {inner}
          </div>
        )}
      </div>
    </li>
  );
}

function iconForKind(kind: string): {
  Icon: typeof Bell;
  tone: string;
} {
  // Tone palette:
  //   emerald = success/positive completion
  //   red     = rejection / negative outcome
  //   amber   = warning / time pressure
  //   sky     = informational / in-progress
  //   gold    = default / neutral promotional
  switch (kind) {
    case "kyc_verified":
      return { Icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" };
    case "kyc_rejected":
      return { Icon: ShieldX, tone: "bg-red-50 text-red-700" };
    case "payment_accepted":
      return { Icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" };
    case "payment_rejected":
      return { Icon: AlertTriangle, tone: "bg-red-50 text-red-700" };
    case "bid_placed":
      return { Icon: Gavel, tone: "bg-sky-50 text-sky-700" };
    case "outbid":
    case "sixth_offer_outbid":
      return { Icon: TrendingUp, tone: "bg-amber-50 text-amber-700" };
    case "watched_new_bid":
      return { Icon: Eye, tone: "bg-sky-50 text-sky-700" };
    case "auction_won":
    case "sixth_offer_awarded":
      return { Icon: Trophy, tone: "bg-emerald-50 text-emerald-700" };
    case "auction_sold_seller":
    case "auction_finalized_seller":
      return { Icon: HandCoins, tone: "bg-emerald-50 text-emerald-700" };
    case "auction_ended_unsold":
    case "reserve_not_met":
      return { Icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" };
    case "auction_ending_soon":
      return { Icon: Hourglass, tone: "bg-amber-50 text-amber-700" };
    case "buy_now_initiated":
      return { Icon: HandCoins, tone: "bg-sky-50 text-sky-700" };
    case "listing_submitted":
      return { Icon: ClipboardList, tone: "bg-sky-50 text-sky-700" };
    case "listing_published":
    case "listing_approved":
      return { Icon: Sparkles, tone: "bg-emerald-50 text-emerald-700" };
    case "listing_rejected":
    case "listing_payment_rejected":
      return { Icon: AlertTriangle, tone: "bg-red-50 text-red-700" };
    case "listing_expired":
      return { Icon: Clock3, tone: "bg-amber-50 text-amber-700" };
    case "inspection_requested":
      return { Icon: FileText, tone: "bg-sky-50 text-sky-700" };
    case "inspection_assigned":
      return { Icon: UserCheck, tone: "bg-sky-50 text-sky-700" };
    case "inspection_scheduled":
      return { Icon: CalendarClock, tone: "bg-sky-50 text-sky-700" };
    case "inspection_completed":
      return { Icon: FileCheck2, tone: "bg-emerald-50 text-emerald-700" };
    case "inspector_approved":
      return { Icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" };
    case "payout_processing":
      return { Icon: Wallet, tone: "bg-sky-50 text-sky-700" };
    case "payout_paid":
      return { Icon: Wallet, tone: "bg-emerald-50 text-emerald-700" };
    case "payout_rejected":
      return { Icon: AlertTriangle, tone: "bg-red-50 text-red-700" };
    case "welcome":
      return { Icon: Megaphone, tone: "bg-[var(--gold-faint)] text-[var(--gold)]" };
    case "seller_received_bid":
      return { Icon: Gavel, tone: "bg-sky-50 text-sky-700" };
    case "seller_sixth_offer_received":
      return { Icon: TrendingUp, tone: "bg-sky-50 text-sky-700" };
    case "auction_live_seller":
    case "auction_live":
      return { Icon: Radio, tone: "bg-emerald-50 text-emerald-700" };
    case "sixth_offer_placed":
      return { Icon: Gavel, tone: "bg-sky-50 text-sky-700" };
    case "payment_receipt_received":
      return { Icon: Receipt, tone: "bg-sky-50 text-sky-700" };
    case "inspector_application_received":
      return { Icon: FileText, tone: "bg-sky-50 text-sky-700" };
    case "final_payment_due_soon":
      return { Icon: Timer, tone: "bg-amber-50 text-amber-700" };
    case "final_payment_due_tomorrow":
      return { Icon: TimerReset, tone: "bg-amber-50 text-amber-700" };
    case "final_payment_overdue":
    case "final_payment_overdue_seller":
      return { Icon: CircleAlert, tone: "bg-red-50 text-red-700" };
    case "admin_kyc_pending":
    case "admin_receipt_pending":
    case "admin_payout_pending":
    case "admin_listing_pending":
    case "admin_inspector_pending":
    case "admin_final_payment_overdue":
      return { Icon: Inbox, tone: "bg-[var(--gold-faint)] text-[var(--gold)]" };
    // Broadcasts (admin-sent to many) — distinct tones so the row at a
    // glance reads as "info / deal / planned downtime / alert" without
    // having to read the title.
    case "announcement":
      return { Icon: Megaphone, tone: "bg-sky-50 text-sky-700" };
    case "promo":
      return { Icon: Tag, tone: "bg-emerald-50 text-emerald-700" };
    case "maintenance":
      return { Icon: Wrench, tone: "bg-amber-50 text-amber-700" };
    case "system_alert":
      return { Icon: ShieldAlert, tone: "bg-red-50 text-red-700" };
    // Lifecycle events with a strong neutral signal — used to fall
    // through to the generic Bell, indistinguishable from broadcasts.
    case "auction_cancelled":
      return { Icon: Ban, tone: "bg-red-50 text-red-700" };
    case "deposit_refunded":
      return { Icon: RefreshCcw, tone: "bg-emerald-50 text-emerald-700" };
    // Gentle reminder kinds (migration 0051) — share the same amber
    // "soft nudge" tone so they don't feel as alarming as auction-
    // ending or payment-overdue but still stand out from passive info.
    case "kyc_pending_reminder":
      return { Icon: Hourglass, tone: "bg-amber-50 text-amber-700" };
    case "listing_unscheduled_reminder":
      return { Icon: CalendarClock, tone: "bg-amber-50 text-amber-700" };
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
