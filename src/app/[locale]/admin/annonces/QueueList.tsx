"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { AdminButton } from "@/components/admin/AdminButton";
import { StatusPill } from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS, FLAG } from "@/components/admin/kit/surface";
import { Check, X, Archive, CalendarPlus, ListChecks } from "lucide-react";

/**
 * The left pane: the queue itself, plus the selection mode that sits on top
 * of it.
 *
 * Selection is **off by default and toggled on**, rather than a checkbox
 * permanently occupying the front of every row. A moderator's normal loop is
 * "read one, decide, next" — a column of empty boxes down the left of that is
 * noise for the common case. Ticking "Sélection" turns the lead dot into a
 * checkbox for the bulk case, and turns it back off when the batch is done.
 *
 * Rows arrive as plain serializable data rather than as rendered nodes: this
 * has to be a client component for the selection state, and pre-rendered
 * cells could not cross that boundary with their interactivity intact.
 */

export type QueueRow = {
  id: string;
  title: string;
  meta: string;
  seller: string;
  category: string;
  gov: string;
  value: string;
  hint: string;
  status: string;
  flag?: "warn" | "bad";
};

export function QueueList({
  rows,
  selectedId,
  hrefBase,
  wide = false,
}: {
  rows: QueueRow[];
  selectedId: string | null;
  /** Current filters as a query string; the row appends `a=<id>` to it. */
  hrefBase: string;
  /** True when the queue owns the whole screen — lay the row out in columns
   *  rather than stretching one line across 1600px with a void in the middle. */
  wide?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // A selection that outlives the rows it was made from would act on rows the
  // operator can no longer see, so it clears whenever the page's rows change.
  const key = rows.map((r) => r.id).join(",");
  useEffect(() => {
    setSelected(new Set());
  }, [key]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOn = rows.length > 0 && selected.size === rows.length;

  async function bulk(action: "approve" | "archive" | "extend") {
    setBusy(action);
    try {
      const res = await fetch("/api/admin/annonces/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action }),
      });
      const data: {
        applied?: number;
        skipped?: { why: string }[];
        detail?: string;
        error?: string;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast(data.detail ?? data.error ?? "L'action groupée a échoué.", "error");
        return;
      }
      const applied = data.applied ?? 0;
      const skipped = data.skipped ?? [];
      const verb = action === "approve" ? "publiée" : action === "archive" ? "archivée" : "prolongée";
      let msg = `${applied} annonce${applied === 1 ? "" : "s"} ${verb}${applied === 1 ? "" : "s"}.`;
      if (skipped.length > 0) {
        const why = [...new Set(skipped.map((s) => s.why))].join(", ");
        msg += ` ${skipped.length} ignorée${skipped.length === 1 ? "" : "s"} (${why}).`;
      }
      toast(msg, skipped.length > 0 ? "warning" : "success");
      setSelected(new Set());
      setPicking(false);
      router.refresh();
    } catch {
      toast("Connexion perdue. Rechargez pour voir ce qui a été appliqué.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Selection strip */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4">
        <button
          type="button"
          onClick={() => {
            setPicking((v) => !v);
            setSelected(new Set());
          }}
          className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium transition ${
            picking ? "text-[var(--gold)]" : "text-subtle hover:text-foreground"
          }`}
        >
          <ListChecks className="size-3.5" strokeWidth={2.2} />
          Sélection
        </button>

        {picking && (
          <button
            type="button"
            onClick={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
            className="text-[11.5px] font-medium text-subtle transition hover:text-foreground"
          >
            {allOn ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
        )}

        <span className="batta-tabular ms-auto text-[11px] text-subtle">
          {rows.length} ligne{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Column header — only in the wide layout, where the columns exist.
          Aligned with the row grid below, including the 14px lead gutter the
          status dot occupies, so the labels sit over their own values. */}
      {wide && (
        <div className="hidden shrink-0 items-center gap-3 border-b border-border px-4 py-1.5 lg:flex">
          <span className="w-[14px] shrink-0" aria-hidden />
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_110px_150px_130px_110px_100px] items-center gap-4 text-[10px] font-bold uppercase tracking-[0.13em] text-subtle">
            <span>Annonce</span>
            <span>Référence</span>
            <span>Vendeur</span>
            <span>Catégorie</span>
            <span className="text-end">Prix</span>
            <span className="text-end">Échéance</span>
          </span>
        </div>
      )}

      {/* Rows */}
      <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
        {rows.map((r) => {
          const isSel = r.id === selectedId;
          const ticked = selected.has(r.id);
          return (
            <li key={r.id}>
              <Link
                href={`${hrefBase}a=${r.id}` as "/admin/annonces"}
                data-row-id={r.id}
                aria-current={isSel ? "true" : undefined}
                prefetch={false}
                className={`${ROW_BASE} ${ROW_FOCUS} ${
                  isSel ? ROW_SELECTED : r.flag ? FLAG[r.flag] : ROW_IDLE
                }`}
              >
                <span className="mt-[6px] shrink-0">
                  {picking ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticked}
                      aria-label={ticked ? "Désélectionner" : "Sélectionner"}
                      onClick={(e) => {
                        // The row is a link; ticking must not navigate.
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(r.id);
                      }}
                      className={`grid size-[14px] place-items-center border transition ${
                        ticked
                          ? "border-[var(--gold)] bg-[var(--gold)] text-black"
                          : "border-border text-transparent hover:border-[var(--gold-soft)]"
                      }`}
                    >
                      <Check className="size-2.5" strokeWidth={3.5} />
                    </button>
                  ) : (
                    <StatusPill status={r.status} dotOnly />
                  )}
                </span>

                {wide ? (
                  /* Columns. The width is spent on the facts a moderator scans
                     — who, what, where, how much, how long — instead of on a
                     gap between a left-aligned title and a right-aligned
                     price. */
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_110px_150px_130px_110px_100px] items-center gap-4">
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[13px] ${
                          isSel ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                        }`}
                      >
                        {r.title}
                      </span>
                    </span>
                    <span className="truncate text-[11.5px] text-subtle">{r.seller}</span>
                    <span className="truncate text-[11.5px] text-subtle">{r.category}</span>
                    <span className="batta-tabular truncate text-end text-[12.5px] text-foreground/90">
                      {r.value}
                    </span>
                    <span className="batta-tabular truncate text-end text-[11px] text-subtle">
                      {r.hint}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] ${
                          isSel ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                        }`}
                      >
                        {r.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                        {r.meta}
                      </span>
                    </span>

                    <span className="shrink-0 text-end">
                      <span className="batta-tabular block text-[12.5px] text-foreground/90">
                        {r.value}
                      </span>
                      <span className="batta-tabular mt-0.5 block text-[11px] text-subtle">
                        {r.hint}
                      </span>
                    </span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Bulk bar — only while something is ticked. */}
      {selected.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--gold-soft)] bg-[var(--row-selected)] px-4 py-2.5">
          <span className="batta-tabular text-[12px] font-semibold text-foreground">
            {selected.size} sélectionnée{selected.size === 1 ? "" : "s"}
          </span>
          <div className="ms-auto flex items-center gap-1.5">
            <AdminButton
              variant="primary"
              pending={busy === "approve"}
              icon={<Check className="size-3.5" strokeWidth={2.8} />}
              onClick={() => bulk("approve")}
            >
              Publier
            </AdminButton>
            <AdminButton
              pending={busy === "extend"}
              icon={<CalendarPlus className="size-3.5" strokeWidth={2.4} />}
              onClick={() => bulk("extend")}
            >
              +30 j
            </AdminButton>
            <AdminButton
              pending={busy === "archive"}
              icon={<Archive className="size-3.5" strokeWidth={2.4} />}
              onClick={() => bulk("archive")}
            >
              Archiver
            </AdminButton>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Annuler la sélection"
              className="grid size-7 place-items-center text-subtle transition hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
