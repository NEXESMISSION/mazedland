"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Loader2, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { Ltr } from "@/components/ui/Ltr";
import { LEAD_STAGES, type LeadStage } from "@/lib/visits";
import { addNoteLine, callBackChoices, QUICK_NOTES, type QuickNote } from "@/lib/pro/leadNotes";
import { cn } from "@/lib/utils";

export type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  stage: LeadStage;
  source: string;
  note: string | null;
  next_action_at: string | null;
  listing: { id: string; title: string } | null;
  updated_label: string;
};

const chip = (on: boolean) =>
  cn(
    "tap-target rounded-full px-4 py-2 text-[13px] font-bold transition disabled:opacity-60",
    on ? "bg-[var(--gold)] text-white" : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
  );

/**
 * The shop's clients (0174): filtered by stage, each with its number, its
 * annonce, a stage to move it to, a note and the day to call back. A client
 * met outside the site is added by hand at the top.
 *
 * The stage is a row of chips, one tap each. The note takes the lines a team
 * member writes most as chips — « Rappelé », « Visite prévue »… — each saved
 * at once with the day it was added; the call-back day is « Demain », « Dans
 * 3 jours » or « Dans une semaine », or any day in the date field. The free
 * text stays for the rest. The requests are the same PATCHes as before.
 */
export function ProClients({
  shopId,
  clients,
  listings,
  today,
}: {
  shopId: string;
  clients: ClientRow[];
  listings: { id: string; title: string }[];
  /** Today in Tunis (YYYY-MM-DD), from the server, so the day chips render the same on both sides. */
  today: string;
}) {
  const t = useTranslations("pro.clients");
  const tStage = useTranslations("pro.clients.stages");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [filter, setFilter] = useState<LeadStage | "open">("open");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", listingId: "", note: "" });
  const [busy, setBusy] = useState<string | null>(null);

  async function call(method: string, body: Record<string, unknown>, ok?: string): Promise<boolean> {
    setBusy(String(body.leadId ?? "new"));
    try {
      const res = await fetch(`/api/pro/shops/${shopId}/leads`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return false;
      }
      if (ok) toast(ok, "success");
      router.refresh();
      return true;
    } catch {
      toast(t("failed"), "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const counts = new Map<string, number>();
  for (const c of clients) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
  const open = clients.filter((c) => c.stage !== "won" && c.stage !== "lost");
  const shown = filter === "open" ? open : clients.filter((c) => c.stage === filter);
  const field = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground focus:border-gold-soft focus:outline-none";

  return (
    <section className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(["open", ...LEAD_STAGES] as const).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)} aria-pressed={filter === s} className={chip(filter === s)}>
              {s === "open" ? t("open") : tStage(s)} <span className="mazed-tabular">{s === "open" ? open.length : counts.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-1.5 px-4 text-[13px]">
          <Plus className="size-4" /> {t("add")}
        </button>
      </div>

      {adding && (
        <form
          className="grid gap-2 rounded-2xl bg-surface p-4 ring-1 ring-border sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("POST", draft, t("added"))) {
              setDraft({ name: "", phone: "", listingId: "", note: "" });
              setAdding(false);
            }
          }}
        >
          {/* Someone else's name and number: the browser must not fill in the
              team member's own. */}
          <input required minLength={2} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("name")} aria-label={t("name")} className={field} dir="auto" autoComplete="off" />
          <input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder={t("phone")} aria-label={t("phone")} inputMode="tel" autoComplete="off" className={field} dir="ltr" />
          <select value={draft.listingId} onChange={(e) => setDraft({ ...draft, listingId: e.target.value })} aria-label={t("listing")} className={`${field} sm:col-span-2`}>
            <option value="">{t("noListing")}</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>{l.title}</option>
            ))}
          </select>
          <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={t("notePlaceholder")} aria-label={t("note")} rows={2} maxLength={2000} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] focus:border-gold-soft focus:outline-none sm:col-span-2" dir="auto" />
          <button type="submit" disabled={busy === "new"} className="mazed-btn-luxe tap-target inline-flex h-10 items-center justify-center gap-1.5 px-4 text-[13px] sm:col-span-2">
            {busy === "new" && <Loader2 className="size-4 animate-spin" />} {t("save")}
          </button>
        </form>
      )}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-[13px] leading-relaxed text-muted">{t(clients.length ? "emptyFilter" : "empty")}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => (
            <li key={c.id} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[14px] font-bold text-foreground">
                  <UserRound className="size-4 text-muted" /> <span dir="auto">{c.name}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-bold text-muted">{t(`sources.${c.source}`)}</span>
                </p>
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-foreground hover:underline">
                    <Phone className="size-3.5 text-muted" /> <Ltr>{c.phone}</Ltr>
                  </a>
                )}
                {c.listing && <p className="mt-0.5 line-clamp-1 text-[12px] text-muted" dir="auto">{c.listing.title}</p>}
              </div>
              <div role="radiogroup" aria-label={t("stage")} className="mt-3 flex flex-wrap gap-2">
                {LEAD_STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={c.stage === s}
                    disabled={busy === c.id}
                    onClick={() => {
                      if (s !== c.stage) void call("PATCH", { leadId: c.id, stage: s }, t("moved"));
                    }}
                    className={chip(c.stage === s)}
                  >
                    {tStage(s)}
                  </button>
                ))}
              </div>
              <ClientNote client={c} today={today} disabled={busy === c.id} onSave={(patch) => call("PATCH", { leadId: c.id, ...patch }, t("saved"))} />
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{c.updated_label}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("deleteConfirm"))) void call("DELETE", { leadId: c.id }, t("deleted"));
                  }}
                  className="tap-target inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Trash2 className="size-3.5" /> {t("delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClientNote({
  client,
  today,
  disabled,
  onSave,
}: {
  client: ClientRow;
  today: string;
  disabled: boolean;
  onSave: (patch: { note: string; next_action_at: string | null }) => Promise<boolean>;
}) {
  const t = useTranslations("pro.clients");
  const [note, setNote] = useState(client.note ?? "");
  const [day, setDay] = useState(client.next_action_at ? client.next_action_at.slice(0, 10) : "");
  const dirty = note !== (client.note ?? "") || day !== (client.next_action_at ? client.next_action_at.slice(0, 10) : "");
  const choices = callBackChoices(today);

  // One tap writes the dated line and saves — with whatever was typed in the
  // note meanwhile, as « Enregistrer » would.
  function addLine(q: QuickNote) {
    const next = addNoteLine(note, t(`quick.${q}`), today);
    setNote(next);
    void onSave({ note: next, next_action_at: day || null });
  }

  function callBackOn(d: string) {
    setDay(d);
    void onSave({ note, next_action_at: d });
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder={t("notePlaceholder")} aria-label={t("note")} className="w-full rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-[12.5px] focus:border-gold-soft focus:outline-none" dir="auto" />
      <div className="flex flex-wrap gap-2" aria-label={t("quickLabel")} role="group">
        {QUICK_NOTES.map((q) => (
          <button key={q} type="button" disabled={disabled} onClick={() => addLine(q)} className={cn(chip(false), "inline-flex items-center gap-1")}>
            <Plus className="size-3.5" /> {t(`quick.${q}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" id={`callback-${client.id}`}>
          <CalendarClock className="size-3.5" /> {t("callBack")}
        </span>
        <div role="radiogroup" aria-labelledby={`callback-${client.id}`} className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={day === c.day} disabled={disabled} onClick={() => callBackOn(c.day)} className={chip(day === c.day)}>
              {t(`when.${c.key}`)}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={day}
          min={today}
          onChange={(e) => setDay(e.target.value)}
          aria-label={t("otherDay")}
          className={cn(
            "h-10 rounded-xl border bg-surface px-2 text-[12.5px] text-foreground",
            day && !choices.some((c) => c.day === day) ? "border-gold" : "border-border",
          )}
        />
        {dirty && (
          <button type="button" disabled={disabled} onClick={() => void onSave({ note, next_action_at: day || null })} className="tap-target inline-flex h-10 items-center rounded-xl border border-border px-4 text-[12.5px] font-bold text-foreground hover:bg-surface-2">
            {t("save")}
          </button>
        )}
      </div>
    </div>
  );
}
