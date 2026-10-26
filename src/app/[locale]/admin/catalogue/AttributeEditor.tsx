"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  TextField, SelectField, NumberField, ToggleField, FieldGrid,
  Confirm, useAdminAction, EYEBROW,
} from "@/components/admin/kit";
import { categoryLabel } from "@/lib/i18n";
import { Plus, Trash2, X, GripVertical, Pencil } from "lucide-react";

/**
 * The right pane: what an annonce in this category is made of.
 *
 * These rows drive both the seller's wizard and the admin's creation form, and
 * `filterable` decides whether a buyer can narrow the catalog by them — so
 * this screen is where "kilométrage" becomes a filter rather than a developer
 * ticket.
 *
 * It also holds the category's names: `label_fr`, and `label_ar`, which the
 * Arabic site shows instead when it is set. A heading (a parent category) has
 * no attributes, so for one this pane is only its names.
 */

export type Attribute = {
  id: string;
  fieldKey: string;
  label: string;
  dataType: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
  required: boolean;
  filterable: boolean;
  sortOrder: number;
  /** How many listings already carry a value under this key. */
  usedBy: number;
};

/** The category row, whole: `category.save` rewrites every column it is sent,
 *  so renaming has to send the others back unchanged. */
export type CategoryInfo = {
  id: string;
  parentId: string | null;
  labelFr: string;
  labelAr: string | null;
  kind: string;
  sortOrder: number;
  isActive: boolean;
};

/** Attribute data types; each has a label under `adminCatalogue.types`. */
const DATA_TYPES = ["text", "number", "boolean", "select"] as const;
const isDataType = (v: string): v is (typeof DATA_TYPES)[number] =>
  (DATA_TYPES as readonly string[]).includes(v);

export function AttributeEditor({
  category,
  heading,
  attributes,
}: {
  category: CategoryInfo;
  /** A parent category: names only, no attributes. */
  heading: boolean;
  attributes: Attribute[];
}) {
  const t = useTranslations("adminCatalogue");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState<Attribute | "new" | null>(null);
  // A heading has nothing else to edit, so it opens straight on its names.
  const [renaming, setRenaming] = useState(heading);

  const name = categoryLabel({ label_fr: category.labelFr, label_ar: category.labelAr }, locale);
  const otherName =
    locale === "ar" ? (category.labelAr ? category.labelFr : null) : category.labelAr;

  // The stored label is French and admin-written; the Arabic console shows the
  // site's own Arabic for the attributes it knows, and the stored one otherwise.
  const attrLabel = (a: Attribute) =>
    locale === "ar" && tRoot.has(`attributes.${a.fieldKey}`)
      ? tRoot(`attributes.${a.fieldKey}`)
      : a.label;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
            {name}
          </h2>
          {otherName ? (
            <span
              lang={locale === "ar" ? "fr" : "ar"}
              dir="auto"
              className="min-w-0 truncate text-[12px] text-subtle"
            >
              {otherName}
            </span>
          ) : locale !== "ar" ? (
            <span className="shrink-0 text-[11.5px] text-[var(--tone-warn)]">
              {t("noArabicName")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AdminButton
            variant="quiet"
            icon={<Pencil className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setRenaming(true)}
          >
            {t("names.rename")}
          </AdminButton>
          {!heading && (
            <AdminButton
              variant="primary"
              icon={<Plus className="size-3.5" strokeWidth={2.8} />}
              onClick={() => setEditing("new")}
            >
              {t("addAttribute")}
            </AdminButton>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {renaming && <CategoryNamesForm category={category} onDone={() => setRenaming(false)} />}

        {heading ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-subtle">{t("headingNote")}</p>
        ) : (
          <>
            {editing && (
              <AttributeForm
                key={editing === "new" ? "new" : editing.id}
                categoryId={category.id}
                attribute={editing === "new" ? null : editing}
                onDone={() => setEditing(null)}
              />
            )}

            {attributes.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-subtle">
                {t("emptyAttributes")}
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {attributes.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="flex w-full items-start gap-3 px-5 py-2.5 text-start transition hover:bg-[var(--row-hover)]"
                    >
                      <GripVertical
                        className="mt-0.5 size-3.5 shrink-0 text-subtle"
                        strokeWidth={2}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                          <span className="truncate">{attrLabel(a)}</span>
                          {a.required && (
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--tone-warn)]">
                              {t("requiredTag")}
                            </span>
                          )}
                          {a.filterable && (
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
                              {t("filterTag")}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                          {isDataType(a.dataType) ? t(`types.${a.dataType}`) : a.dataType}
                          {a.unit ? ` · ${a.unit}` : ""}
                          {a.options ? ` · ${t("optionsCount", { count: a.options.length })}` : ""}
                          {" · "}
                          <code className="text-[11px] opacity-70">{a.fieldKey}</code>
                        </span>
                      </span>
                      {a.usedBy > 0 && (
                        <span className="mazed-tabular shrink-0 text-[11px] text-subtle">
                          {t("usedBy", { count: a.usedBy })}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The category's two names. An empty Arabic name is saved as null (the API
 * trims), and the Arabic site then falls back to the French one.
 */
function CategoryNamesForm({
  category,
  onDone,
}: {
  category: CategoryInfo;
  onDone: () => void;
}) {
  const t = useTranslations("adminCatalogue");
  const { run, pending } = useAdminAction();
  const [labelFr, setLabelFr] = useState(category.labelFr);
  const [labelAr, setLabelAr] = useState(category.labelAr ?? "");

  async function save() {
    const ok = await run({
      url: "/api/admin/catalogue",
      method: "POST",
      body: {
        action: "category.save",
        id: category.id,
        parent_id: category.parentId,
        label_fr: labelFr,
        label_ar: labelAr,
        kind: category.kind,
        sort_order: category.sortOrder,
        is_active: category.isActive,
      },
      success: t("names.saved"),
    });
    if (ok) onDone();
  }

  return (
    <div className="border-b border-border bg-[var(--gold-faint)] px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className={`${EYEBROW} text-[var(--gold)]`}>{t("names.title")}</h3>
        <button
          type="button"
          onClick={onDone}
          aria-label={t("form.close")}
          className="grid size-6 place-items-center text-subtle transition hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={2.4} />
        </button>
      </div>

      <div className="mt-3 space-y-3.5">
        <FieldGrid>
          <TextField label={t("names.labelFr")} value={labelFr} onChange={setLabelFr} required />
          <TextField
            label={t("names.labelAr")}
            value={labelAr}
            onChange={setLabelAr}
            hint={t("names.labelArHint")}
          />
        </FieldGrid>

        <div className="flex items-center gap-2">
          <AdminButton
            variant="primary"
            pending={pending}
            disabled={!labelFr.trim()}
            disabledReason={t("names.nameRequired")}
            onClick={save}
          >
            {t("form.save")}
          </AdminButton>
          <AdminButton variant="quiet" onClick={onDone}>
            {t("form.cancel")}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

function AttributeForm({
  categoryId,
  attribute,
  onDone,
}: {
  categoryId: string;
  attribute: Attribute | null;
  onDone: () => void;
}) {
  const t = useTranslations("adminCatalogue");
  const { run, pending } = useAdminAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [label, setLabel] = useState(attribute?.label ?? "");
  const [dataType, setDataType] = useState(attribute?.dataType ?? "text");
  const [unit, setUnit] = useState(attribute?.unit ?? "");
  const [required, setRequired] = useState(attribute?.required ?? false);
  const [filterable, setFilterable] = useState(attribute?.filterable ?? false);
  const [sortOrder, setSortOrder] = useState<number | null>(attribute?.sortOrder ?? 100);
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    attribute?.options ?? [],
  );

  const isNew = attribute === null;

  async function save() {
    const ok = await run({
      url: "/api/admin/catalogue",
      method: "POST",
      body: {
        action: "attribute.save",
        ...(isNew ? {} : { id: attribute.id }),
        category_id: categoryId,
        label,
        data_type: dataType,
        options: dataType === "select" ? options : null,
        unit,
        required,
        filterable,
        sort_order: sortOrder,
      },
      success: isNew ? t("form.added") : t("form.saved"),
    });
    if (ok) onDone();
  }

  return (
    <div className="border-b border-border bg-[var(--gold-faint)] px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className={`${EYEBROW} text-[var(--gold)]`}>
          {isNew ? t("form.newTitle") : attribute.label}
        </h3>
        <button
          type="button"
          onClick={onDone}
          aria-label={t("form.close")}
          className="grid size-6 place-items-center text-subtle transition hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={2.4} />
        </button>
      </div>

      <div className="mt-3 space-y-3.5">
        <FieldGrid>
          <TextField
            label={t("form.label")}
            value={label}
            onChange={setLabel}
            required
            placeholder={t("form.labelPlaceholder")}
          />
          <SelectField
            label={t("form.type")}
            value={dataType}
            onChange={setDataType}
            disabled={!isNew}
            hint={isNew ? undefined : t("form.typeLocked")}
            options={DATA_TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
          />
        </FieldGrid>

        <FieldGrid>
          <TextField
            label={t("form.unit")}
            value={unit}
            onChange={setUnit}
            placeholder={t("form.unitPlaceholder")}
            hint={t("form.unitHint")}
          />
          <NumberField
            label={t("form.order")}
            value={sortOrder}
            onChange={setSortOrder}
            min={0}
            hint={t("form.orderHint")}
          />
        </FieldGrid>

        {dataType === "select" && (
          <div>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
              {t("form.options")}
            </span>
            <ul className="mt-2 space-y-1.5">
              {options.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={o.label}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    placeholder={t("form.optionPlaceholder")}
                    className="h-8 flex-1 border-b border-border bg-transparent px-1 text-[12.5px] text-foreground placeholder:text-subtle focus:border-[var(--gold)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t("form.removeOption")}
                    className="grid size-6 place-items-center text-subtle transition hover:text-[var(--tone-bad)]"
                  >
                    <X className="size-3.5" strokeWidth={2.4} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, { value: "", label: "" }])}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--gold)] hover:underline"
            >
              <Plus className="size-3" strokeWidth={2.8} /> {t("form.addOption")}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <ToggleField
            label={t("form.required")}
            checked={required}
            onChange={setRequired}
            hint={t("form.requiredHint")}
          />
          <ToggleField
            label={t("form.filterable")}
            checked={filterable}
            onChange={setFilterable}
            hint={t("form.filterableHint")}
          />
        </div>

        <div className="flex items-center gap-2">
          <AdminButton
            variant="primary"
            pending={pending}
            disabled={!label.trim()}
            disabledReason={t("form.labelMissing")}
            onClick={save}
          >
            {isNew ? t("form.add") : t("form.save")}
          </AdminButton>
          <AdminButton variant="quiet" onClick={onDone}>
            {t("form.cancel")}
          </AdminButton>
          {!isNew && (
            <AdminButton
              variant="quiet"
              className="ms-auto"
              icon={<Trash2 className="size-3.5" strokeWidth={2.4} />}
              onClick={() => setConfirmDelete(true)}
            >
              {t("form.delete")}
            </AdminButton>
          )}
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        title={t("form.confirmDeleteTitle")}
        body={t("form.confirmDeleteBody")}
        confirmLabel={t("form.delete")}
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const ok = await run({
            url: "/api/admin/catalogue",
            method: "POST",
            body: { action: "attribute.delete", id: attribute!.id },
            success: t("form.deleted"),
          });
          if (ok) {
            setConfirmDelete(false);
            onDone();
          }
        }}
      />
    </div>
  );
}
