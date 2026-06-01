"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  Loader2, Star, ArrowUpToLine, Megaphone, ImageOff, Check, X,
} from "lucide-react";

export type HomeRow = {
  id: string;
  title: string;
  governorate: string;
  home: boolean;
  top: boolean;
  banner: boolean;
  expiresAt: string | null;
  expired: boolean;
  manual: boolean;
  featured: boolean;
  coverUrl: string | null;
};

const DAYS = [7, 30, 90, 0];

export function HomeControlClient({ rows }: { rows: HomeRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  // Local edit state per row (placements + days), seeded from server.
  const [edit, setEdit] = useState<Record<string, { home: boolean; top: boolean; banner: boolean; days: number }>>(
    () => Object.fromEntries(rows.map((r) => [r.id, { home: r.home, top: r.top, banner: r.banner, days: 30 }])),
  );
  const [open, setOpen] = useState<string | null>(null);

  function set(id: string, patch: Partial<{ home: boolean; top: boolean; banner: boolean; days: number }>) {
    setEdit((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  }

  async function apply(id: string, override?: Partial<{ home: boolean; top: boolean; banner: boolean; days: number }>) {
    const cur = { ...edit[id], ...override };
    setBusy(id);
    try {
      const res = await fetch("/api/admin/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: id,
          home_featured: cur.home,
          top_listed: cur.top,
          banner: cur.banner,
          days: cur.days,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(j.error ?? "Échec.", "error");
        return;
      }
      toast(cur.home || cur.top || cur.banner ? "Mise en vedette appliquée." : "Retirée de la vedette.", "success");
      setOpen(null);
      start(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="mt-5 space-y-2.5">
      {rows.map((r) => {
        const e = edit[r.id];
        const isOpen = open === r.id;
        return (
          <li key={r.id} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
            <div className="flex items-start gap-3 p-3">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                {r.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted"><ImageOff className="size-5" /></div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-foreground">{r.title}</div>
                <div className="mt-0.5 text-[11px] text-muted">{r.governorate}</div>
                {/* Current placement chips */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {r.featured ? (
                    <>
                      {r.home && <Chip icon={<Star className="size-2.5" />} label="Accueil" />}
                      {r.top && <Chip icon={<ArrowUpToLine className="size-2.5" />} label="Top" />}
                      {r.banner && <Chip icon={<Megaphone className="size-2.5" />} label="Bannière" />}
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] ${r.manual ? "bg-sky-50 text-sky-700" : "batta-tone-ok"}`}>
                        {r.manual ? "Manuel" : "Payé"}
                      </span>
                      {r.expiresAt && (
                        <span className="text-[10px] text-muted">
                          exp. {new Date(r.expiresAt).toLocaleDateString("fr-FR")}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[11px] text-muted">Non mise en avant{r.expired ? " (expirée)" : ""}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {r.featured && (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => apply(r.id, { home: false, top: false, banner: false })}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--accent-faint)] disabled:opacity-50"
                  >
                    <X className="size-3.5" /> Retirer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-batta-gold/12 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-batta-gold-bright ring-1 ring-batta-gold/30 hover:bg-batta-gold/20"
                >
                  {r.featured ? "Modifier" : "Mettre en vedette"}
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-border bg-surface-2/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle on={e.home} label="Accueil" icon={<Star className="size-3" />} onClick={() => set(r.id, { home: !e.home })} />
                  <Toggle on={e.top} label="Top recherche" icon={<ArrowUpToLine className="size-3" />} onClick={() => set(r.id, { top: !e.top })} />
                  <Toggle on={e.banner} label="Bannière" icon={<Megaphone className="size-3" />} onClick={() => set(r.id, { banner: !e.banner })} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-muted">Durée :</span>
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set(r.id, { days: d })}
                      className={
                        "rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                        (e.days === d ? "bg-gold text-white" : "bg-surface text-foreground ring-1 ring-border hover:ring-gold-soft")
                      }
                    >
                      {d === 0 ? "Sans expiration" : `${d} j`}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => apply(r.id)}
                    className="batta-btn-luxe tap-target ms-auto inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] disabled:opacity-50"
                  >
                    {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" strokeWidth={2.5} />}
                    Appliquer
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
      {rows.length === 0 && (
        <li className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted">
          Aucune annonce publiée pour le moment.
        </li>
      )}
    </ul>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[10px] font-bold text-gold-bright ring-1 ring-gold/25">
      {icon} {label}
    </span>
  );
}

function Toggle({ on, label, icon, onClick }: { on: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition " +
        (on
          ? "border-gold bg-gold-faint text-gold-bright"
          : "border-border bg-surface text-muted hover:border-gold-soft")
      }
    >
      {icon} {label}
    </button>
  );
}
