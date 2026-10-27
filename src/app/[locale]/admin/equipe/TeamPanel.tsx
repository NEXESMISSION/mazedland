"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, UserPlus, Check } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm, useAdminAction } from "@/components/admin/kit";
import { Ltr } from "@/components/ui/Ltr";
import {
  ADMIN_SECTIONS,
  ROLE_PRESETS,
  ROLE_PRESET_KEYS,
  presetOf,
  type AdminScopes,
  type AdminSection,
  type RolePreset,
} from "@/lib/admin/sections";

export type Member = {
  id: string;
  name: string;
  phone: string | null;
  scopes: AdminScopes;
  banned: boolean;
};

type Choice = RolePreset | "full" | "custom";
const CHOICES: Choice[] = ["full", ...ROLE_PRESET_KEYS, "custom"];

/** What the picker holds, as the API takes it. */
function scopesOf(choice: Choice, custom: AdminSection[]): "full" | AdminSection[] {
  if (choice === "full") return "full";
  if (choice === "custom") return custom;
  return [...ROLE_PRESETS[choice]];
}

/**
 * The members and an « Ajouter » box. Access is a choice of role — admin
 * complet, modération, finance, contenu — or « Sur mesure », where the
 * sections are ticked one by one. Nobody edits their own access here.
 */
export function TeamPanel({ members, selfId }: { members: Member[]; selfId: string }) {
  const t = useTranslations("adminTeam");
  return (
    <div className="mt-5 space-y-8">
      <AddMember known={new Set(members.map((m) => m.id))} />
      <section>
        <h2 className="text-[13px] font-semibold text-foreground">{t("members.title")}</h2>
        <ul className="mt-2 border-t border-border">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} self={m.id === selfId} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function AccessPicker({
  choice,
  custom,
  onChoice,
  onCustom,
}: {
  choice: Choice;
  custom: AdminSection[];
  onChoice: (c: Choice) => void;
  onCustom: (s: AdminSection[]) => void;
}) {
  const t = useTranslations("adminTeam");
  const shown = choice === "custom" || choice === "full" ? null : ROLE_PRESETS[choice];
  return (
    <div>
      <div role="radiogroup" aria-label={t("access")} className="flex flex-wrap gap-1.5">
        {CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={choice === c}
            onClick={() => onChoice(c)}
            title={t(`presets.${c}.hint`)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
              choice === c
                ? "bg-[var(--gold)] text-[var(--background)]"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {t(`presets.${c}.label`)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-subtle">
        {shown ? shown.map((s) => t(`sections.${s}`)).join(" · ") : t(`presets.${choice}.hint`)}
      </p>
      {choice === "custom" && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {ADMIN_SECTIONS.map((s) => {
            const on = custom.includes(s);
            return (
              <label key={s} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onCustom(on ? custom.filter((x) => x !== s) : [...custom, s])}
                  className="size-3.5 accent-[var(--gold)]"
                />
                {t(`sections.${s}`)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member, self }: { member: Member; self: boolean }) {
  const t = useTranslations("adminTeam");
  const { run, pending, done } = useAdminAction();
  const initial = presetOf(member.scopes);
  const [choice, setChoice] = useState<Choice>(initial);
  const [custom, setCustom] = useState<AdminSection[]>(member.scopes ? [...member.scopes] : []);
  const [removing, setRemoving] = useState(false);

  const wanted = scopesOf(choice, custom);
  const before = member.scopes === null ? "full" : [...member.scopes].sort().join(",");
  const after = wanted === "full" ? "full" : [...wanted].sort().join(",");
  const changed = before !== after;
  const empty = wanted !== "full" && wanted.length === 0;

  return (
    <li className="border-b border-border py-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13.5px] font-semibold text-foreground">{member.name}</span>
        {member.phone && <Ltr className="text-[12px] text-subtle">{member.phone}</Ltr>}
        {self && <span className="text-[11.5px] font-semibold text-[var(--gold)]">{t("members.you")}</span>}
        {member.banned && <span className="text-[11.5px] font-semibold text-[var(--tone-bad)]">{t("members.banned")}</span>}
      </div>

      {self ? (
        <p className="mt-1.5 text-[12px] text-muted">
          {t(`presets.${initial}.label`)} — {t("members.selfHint")}
        </p>
      ) : (
        <div className="mt-2.5">
          <AccessPicker choice={choice} custom={custom} onChoice={setChoice} onCustom={setCustom} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AdminButton
              variant="primary"
              disabled={!changed || empty}
              pending={pending}
              done={done}
              doneLabel={t("saved")}
              onClick={() =>
                run({ url: "/api/admin/equipe", method: "POST", body: { userId: member.id, scopes: wanted }, success: t("saved") })
              }
            >
              {t("save")}
            </AdminButton>
            <AdminButton variant="quiet" onClick={() => setRemoving(true)}>
              {t("members.remove")}
            </AdminButton>
          </div>
        </div>
      )}

      <Confirm
        open={removing}
        title={t("members.removeTitle", { name: member.name })}
        body={t("members.removeBody")}
        confirmLabel={t("members.remove")}
        pending={pending}
        onCancel={() => setRemoving(false)}
        onConfirm={async () => {
          const ok = await run({
            url: "/api/admin/equipe",
            method: "DELETE",
            body: { userId: member.id },
            success: t("members.removed"),
          });
          if (ok) setRemoving(false);
        }}
      />
    </li>
  );
}

type Found = { id: string; name: string; phone: string | null };

function AddMember({ known }: { known: Set<string> }) {
  const t = useTranslations("adminTeam");
  const { run, pending } = useAdminAction();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [chosen, setChosen] = useState<Found | null>(null);
  const [choice, setChoice] = useState<Choice>("moderation");
  const [custom, setCustom] = useState<AdminSection[]>([]);

  // The same account search as the console's « créer une annonce ».
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/admin/vendeurs/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { sellers: [] }))
        .then((j: { sellers?: Found[] }) => setFound(j.sellers ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q]);

  const wanted = scopesOf(choice, custom);
  const empty = wanted !== "full" && wanted.length === 0;
  // Results of an older, longer search stay out once the box is cleared.
  const results = q.trim().length >= 2 ? found : [];

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <UserPlus className="size-4 text-subtle" /> {t("add.title")}
      </h2>
      <p className="mt-1 text-[12px] text-muted">{t("add.hint")}</p>

      {chosen ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <Check className="size-3.5 self-center text-[var(--tone-ok)]" />
            <span className="text-[13px] font-semibold text-foreground">{chosen.name}</span>
            {chosen.phone && <Ltr className="text-[12px] text-subtle">{chosen.phone}</Ltr>}
            <button type="button" onClick={() => setChosen(null)} className="text-[12px] text-muted underline hover:text-foreground">
              {t("add.change")}
            </button>
          </div>
          <div className="mt-3">
            <AccessPicker choice={choice} custom={custom} onChoice={setChoice} onCustom={setCustom} />
          </div>
          <AdminButton
            className="mt-3"
            variant="primary"
            disabled={empty}
            pending={pending}
            onClick={async () => {
              const ok = await run({
                url: "/api/admin/equipe",
                method: "POST",
                body: { userId: chosen.id, scopes: wanted },
                success: t("add.done", { name: chosen.name }),
              });
              if (ok) {
                setChosen(null);
                setQ("");
              }
            }}
          >
            {t("add.submit")}
          </AdminButton>
        </div>
      ) : (
        <div className="mt-3">
          <label className="relative block max-w-md">
            <span className="sr-only">{t("add.search")}</span>
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("add.search")}
              className="h-9 w-full rounded border border-border bg-background ps-8 pe-3 text-[13px] text-foreground outline-none focus:border-[var(--gold-soft)]"
            />
          </label>
          {results.length > 0 && (
            <ul className="mt-2 max-w-md divide-y divide-border rounded border border-border">
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={known.has(f.id)}
                    onClick={() => setChosen(f)}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-start text-[12.5px] transition hover:bg-[var(--row-hover)] disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="font-medium text-foreground">{f.name}</span>
                    {f.phone && <Ltr className="text-[11.5px] text-subtle">{f.phone}</Ltr>}
                    {known.has(f.id) && <span className="ms-auto text-[11px] text-subtle">{t("add.already")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
