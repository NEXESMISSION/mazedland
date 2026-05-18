"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  Check, Loader2, Save, Plus, Trash2, ChevronUp, ChevronDown,
} from "lucide-react";
import type { PropertyType } from "@/lib/types";

export type LegalDocKindRow = {
  id: string;
  property_type: PropertyType;
  label: string;
  description: string | null;
  required: boolean;
  sort_order: number;
};

type DraftRow = {
  // Local draft id for unsaved rows; persisted rows keep their server id.
  localId: string;
  id?: string;
  label: string;
  description: string;
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

function rowToDraft(r: LegalDocKindRow, idx: number): DraftRow {
  return {
    localId: r.id,
    id: r.id,
    label: r.label,
    description: r.description ?? "",
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
    description: "",
    required: false,
    sort_order: sort,
  };
}

export function LegalDocsEditor({
  initial,
}: {
  initial: Record<PropertyType, LegalDocKindRow[]>;
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

  function update(idx: number, patch: Partial<DraftRow>) {
    setDrafts((d) => ({
      ...d,
      [activeType]: d[activeType].map((row, i) =>
        i === idx ? { ...row, ...patch } : row,
      ),
    }));
    setSavedType(null);
    setDirty((s) => new Set(s).add(activeType));
  }

  function remove(idx: number) {
    setDrafts((d) => ({
      ...d,
      [activeType]: d[activeType].filter((_, i) => i !== idx),
    }));
    setSavedType(null);
    setDirty((s) => new Set(s).add(activeType));
  }

  function add() {
    setDrafts((d) => {
      const lastSort = d[activeType].at(-1)?.sort_order ?? 0;
      return {
        ...d,
        [activeType]: [...d[activeType], newDraft(lastSort + 10)],
      };
    });
    setSavedType(null);
    setDirty((s) => new Set(s).add(activeType));
  }

  function move(idx: number, dir: -1 | 1) {
    setDrafts((d) => {
      const arr = [...d[activeType]];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      // Renormalise sort_order so newly-saved rows land in the right place.
      arr.forEach((r, i) => { r.sort_order = (i + 1) * 10; });
      return { ...d, [activeType]: arr };
    });
    setSavedType(null);
    setDirty((s) => new Set(s).add(activeType));
  }

  function onSave() {
    const items = list.map((r) => ({
      id: r.id,
      label: r.label.trim(),
      description: r.description.trim() || null,
      required: r.required,
      sort_order: r.sort_order,
    }));

    // Client-side validation: empty labels & duplicates.
    for (let i = 0; i < items.length; i++) {
      if (!items[i].label) {
        toast(`Ligne ${i + 1} : le titre est requis.`, "error");
        return;
      }
    }
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const key = items[i].label.toLowerCase();
      if (seen.has(key)) {
        toast(`Doublon : "${items[i].label}".`, "error");
        return;
      }
      seen.add(key);
    }

    setSavingType(activeType);
    startTransition(async () => {
      const res = await fetch("/api/admin/legal-docs", {
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
      toast(`Catalogue ${TYPE_LABELS_FR[activeType]} enregistré.`, "success");
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
                ? "Aucun document configuré — le vendeur n'aura rien à téléverser."
                : `${list.length} document${list.length > 1 ? "s" : ""} configuré${list.length > 1 ? "s" : ""}.`}
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
              Cliquez sur <b>Ajouter</b> pour créer un document à fournir.
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
                      placeholder="Titre du document (ex. Titre foncier)"
                      onChange={(e) => update(i, { label: e.target.value })}
                      className="w-full rounded-lg border border-batta-gold/25 bg-batta-surface px-3 py-2 text-sm font-semibold text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
                    />
                    <textarea
                      rows={2}
                      value={row.description}
                      placeholder="Aide affichée au vendeur (optionnel)"
                      onChange={(e) => update(i, { description: e.target.value })}
                      className="w-full rounded-lg border border-batta-gold/25 bg-batta-surface px-3 py-2 text-[12px] text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
                    />
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
                        className="tap-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/10"
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
