"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  Check, Loader2, Save, Plus, Trash2, ChevronUp, ChevronDown,
} from "lucide-react";
import type { PropertyType, AttributeDataType, AttributeKind } from "@/lib/types";

type DraftOption = { value: string; label: string };

type DraftRow = {
  localId: string;
  id?: string;
  field_key?: string; // present for saved rows; new rows get one on save
  label: string;
  data_type: AttributeDataType;
  options: DraftOption[];
  unit: string;
  required: boolean;
  sort_order: number;
};

const PROPERTY_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

const TYPE_LABELS_FR: Record<PropertyType, string> = {
  apartment: "Appartement",
  house: "Maison",
  villa: "Villa",
  land: "Terrain",
  commercial: "Local commercial",
  office: "Bureau",
  warehouse: "Entrepôt",
  farm: "Ferme",
};

const DATA_TYPE_LABELS: Record<AttributeDataType, string> = {
  number: "Nombre",
  text: "Texte",
  boolean: "Oui / Non",
  select: "Liste de choix",
};

function rowToDraft(r: AttributeKind, idx: number): DraftRow {
  return {
    localId: r.id,
    id: r.id,
    field_key: r.field_key,
    label: r.label,
    data_type: r.data_type,
    options: (r.options ?? []).map((o) => ({ value: o.value, label: o.label })),
    unit: r.unit ?? "",
    required: r.required,
    sort_order: r.sort_order || idx * 10,
  };
}

let draftCounter = 0;
function newDraft(sort: number): DraftRow {
  draftCounter += 1;
  return {
    localId: `new-${Date.now()}-${draftCounter}`,
    label: "",
    data_type: "number",
    options: [],
    unit: "",
    required: false,
    sort_order: sort,
  };
}

export function CharacteristicsEditor({
  initial,
}: {
  initial: Record<PropertyType, AttributeKind[]>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeType, setActiveType] = useState<PropertyType>("apartment");
  const [drafts, setDrafts] = useState<Record<PropertyType, DraftRow[]>>(() =>
    Object.fromEntries(
      PROPERTY_TYPES.map((t) => [t, initial[t].map(rowToDraft)]),
    ) as Record<PropertyType, DraftRow[]>,
  );
  const [dirty, setDirty] = useState<Set<PropertyType>>(new Set());
  const [savingType, setSavingType] = useState<PropertyType | null>(null);
  const [savedType, setSavedType] = useState<PropertyType | null>(null);
  const [isPending, startTransition] = useTransition();

  const list = drafts[activeType];

  function touch() {
    setSavedType(null);
    setDirty((s) => new Set(s).add(activeType));
  }

  function update(idx: number, patch: Partial<DraftRow>) {
    setDrafts((d) => ({
      ...d,
      [activeType]: d[activeType].map((row, i) =>
        i === idx ? { ...row, ...patch } : row,
      ),
    }));
    touch();
  }

  function remove(idx: number) {
    setDrafts((d) => ({
      ...d,
      [activeType]: d[activeType].filter((_, i) => i !== idx),
    }));
    touch();
  }

  function add() {
    setDrafts((d) => {
      const lastSort = d[activeType].at(-1)?.sort_order ?? 0;
      return { ...d, [activeType]: [...d[activeType], newDraft(lastSort + 10)] };
    });
    touch();
  }

  function move(idx: number, dir: -1 | 1) {
    setDrafts((d) => {
      const arr = [...d[activeType]];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      arr.forEach((r, i) => { r.sort_order = (i + 1) * 10; });
      return { ...d, [activeType]: arr };
    });
    touch();
  }

  // ─── Options sub-editor (select fields only) ───────────────────────────
  function addOption(idx: number) {
    update(idx, { options: [...list[idx].options, { value: "", label: "" }] });
  }
  function updateOption(idx: number, oi: number, patch: Partial<DraftOption>) {
    update(idx, {
      options: list[idx].options.map((o, i) => (i === oi ? { ...o, ...patch } : o)),
    });
  }
  function removeOption(idx: number, oi: number) {
    update(idx, { options: list[idx].options.filter((_, i) => i !== oi) });
  }

  function onSave() {
    const items = list.map((r) => ({
      id: r.id,
      label: r.label.trim(),
      data_type: r.data_type,
      options:
        r.data_type === "select"
          ? r.options.map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
          : undefined,
      unit: r.unit.trim() || null,
      required: r.required,
      sort_order: r.sort_order,
    }));

    // Client-side validation: labels, duplicates, select options.
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      if (!items[i].label) {
        toast(`Ligne ${i + 1} : le titre est requis.`, "error");
        return;
      }
      const key = items[i].label.toLowerCase();
      if (seen.has(key)) {
        toast(`Doublon : "${items[i].label}".`, "error");
        return;
      }
      seen.add(key);
      if (items[i].data_type === "select") {
        const opts = items[i].options ?? [];
        if (opts.length === 0) {
          toast(`"${items[i].label}" : ajoutez au moins un choix.`, "error");
          return;
        }
        for (const o of opts) {
          if (!o.value || !o.label) {
            toast(`"${items[i].label}" : chaque choix a besoin d'une valeur et d'un libellé.`, "error");
            return;
          }
        }
      }
    }

    setSavingType(activeType);
    startTransition(async () => {
      const res = await fetch("/api/admin/characteristics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_type: activeType, items }),
      });
      setSavingType(null);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.error ?? "Échec de l'enregistrement.", "error");
        return;
      }
      setSavedType(activeType);
      setDirty((s) => {
        const next = new Set(s);
        next.delete(activeType);
        return next;
      });
      toast(`Caractéristiques ${TYPE_LABELS_FR[activeType]} enregistrées.`, "success");
      router.refresh();
    });
  }

  return (
    <div>
      {/* Property-type tabs */}
      <nav className="snap-rail hide-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        {PROPERTY_TYPES.map((t) => {
          const isActive = t === activeType;
          const isDirty = dirty.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => setActiveType(t)}
              className={
                "tap-target inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition active:scale-[0.97] " +
                (isActive
                  ? "border-batta-gold/60 bg-batta-gold/12 text-batta-gold-bright"
                  : "border-border bg-surface text-foreground hover:border-gold/40 hover:text-gold-bright")
              }
            >
              {TYPE_LABELS_FR[t]}
              <span className="text-[10px] font-normal opacity-70">
                · {drafts[t].length}
              </span>
              {isDirty && (
                <span
                  aria-label="non enregistré"
                  className="inline-block size-1.5 rounded-full bg-orange-400"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* List */}
      <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-bold text-foreground">
              {TYPE_LABELS_FR[activeType]}
            </h3>
            <p className="text-[11.5px] text-[var(--foreground-muted)]">
              {list.length === 0
                ? "Aucune caractéristique — le vendeur n'aura aucun champ à remplir."
                : `${list.length} champ${list.length > 1 ? "s" : ""} configuré${list.length > 1 ? "s" : ""}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={add}
            className="tap-target inline-flex items-center gap-1 rounded-lg bg-batta-gold/12 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-batta-gold-bright ring-1 ring-batta-gold/30 hover:bg-batta-gold/20"
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
            Ajouter
          </button>
        </header>

        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-batta-gold/25 bg-batta-surface-2 p-6 text-center">
            <p className="text-[12px] text-[var(--foreground-muted)]">
              Cliquez sur <b>Ajouter</b> pour créer un champ de caractéristique.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {list.map((row, i) => (
              <li
                key={row.localId}
                className="rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3"
              >
                <div className="flex items-start gap-2">
                  {/* Reorder controls */}
                  <div className="mt-1 flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="tap-target inline-flex size-6 items-center justify-center rounded-md text-foreground/70 hover:bg-batta-gold/10 hover:text-batta-gold-bright disabled:opacity-30"
                      aria-label="Monter"
                    >
                      <ChevronUp className="size-3.5" strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, +1)}
                      disabled={i === list.length - 1}
                      className="tap-target inline-flex size-6 items-center justify-center rounded-md text-foreground/70 hover:bg-batta-gold/10 hover:text-batta-gold-bright disabled:opacity-30"
                      aria-label="Descendre"
                    >
                      <ChevronDown className="size-3.5" strokeWidth={2.5} />
                    </button>
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={row.label}
                      placeholder="Titre du champ (ex. Surface, Ascenseur)"
                      onChange={(e) => update(i, { label: e.target.value })}
                      className="w-full rounded-lg border border-batta-gold/25 bg-batta-surface px-3 py-2 text-sm font-semibold text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
                    />

                    {/* Type + unit row */}
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={row.data_type}
                        onChange={(e) =>
                          update(i, { data_type: e.target.value as AttributeDataType })
                        }
                        className="rounded-lg border border-batta-gold/25 bg-batta-surface px-2.5 py-2 text-[12px] text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
                      >
                        {(Object.keys(DATA_TYPE_LABELS) as AttributeDataType[]).map((dt) => (
                          <option key={dt} value={dt}>
                            {DATA_TYPE_LABELS[dt]}
                          </option>
                        ))}
                      </select>
                      {(row.data_type === "number" || row.data_type === "text") && (
                        <input
                          type="text"
                          value={row.unit}
                          placeholder="Unité (ex. m², ha)"
                          onChange={(e) => update(i, { unit: e.target.value })}
                          className="w-28 rounded-lg border border-batta-gold/25 bg-batta-surface px-2.5 py-2 text-[12px] text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
                        />
                      )}
                      {row.field_key && (
                        <span className="inline-flex items-center rounded-md bg-batta-surface px-2 py-1 font-mono text-[10.5px] text-[var(--foreground-muted)] ring-1 ring-border">
                          {row.field_key}
                        </span>
                      )}
                    </div>

                    {/* Options editor (select only) */}
                    {row.data_type === "select" && (
                      <div className="rounded-lg border border-dashed border-batta-gold/25 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                            Choix
                          </span>
                          <button
                            type="button"
                            onClick={() => addOption(i)}
                            className="tap-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold text-batta-gold-bright hover:bg-batta-gold/10"
                          >
                            <Plus className="size-3" strokeWidth={2.5} />
                            Choix
                          </button>
                        </div>
                        {row.options.length === 0 ? (
                          <p className="text-[11px] text-[var(--foreground-muted)]">
                            Ajoutez les choix proposés au vendeur.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {row.options.map((o, oi) => (
                              <li key={oi} className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={o.label}
                                  placeholder="Libellé (ex. Titre bleu)"
                                  onChange={(e) => updateOption(i, oi, { label: e.target.value })}
                                  className="flex-1 rounded-md border border-batta-gold/25 bg-batta-surface px-2 py-1.5 text-[12px] text-batta-cream focus:border-batta-gold focus:outline-none"
                                />
                                <input
                                  type="text"
                                  value={o.value}
                                  placeholder="valeur (ex. titre_bleu)"
                                  onChange={(e) => updateOption(i, oi, { value: e.target.value })}
                                  className="w-32 rounded-md border border-batta-gold/25 bg-batta-surface px-2 py-1.5 font-mono text-[11px] text-batta-cream focus:border-batta-gold focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOption(i, oi)}
                                  className="tap-target inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--danger)] hover:bg-[var(--accent-faint)]"
                                  aria-label="Supprimer le choix"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={(e) => update(i, { required: e.target.checked })}
                          className="size-4 accent-batta-gold-bright"
                        />
                        <span className="font-semibold">Requis</span>
                        <span className="text-[10.5px] text-[var(--foreground-muted)]">
                          bloque la soumission
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="tap-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--accent-faint)]"
                      >
                        <Trash2 className="size-3.5" />
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-3 z-10 mt-5">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !dirty.has(activeType)}
          className="batta-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
        >
          {savingType === activeType ? (
            <Loader2 className="size-4 animate-spin" />
          ) : savedType === activeType ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : (
            <Save className="size-4" strokeWidth={2.5} />
          )}
          {savingType === activeType
            ? "Enregistrement…"
            : savedType === activeType
              ? "Enregistré"
              : `Enregistrer (${TYPE_LABELS_FR[activeType]})`}
        </button>
      </div>
    </div>
  );
}
