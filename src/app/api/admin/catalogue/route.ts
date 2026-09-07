import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Categories and their attributes — the shape of an annonce.
 *
 * This does NOT replace `/api/admin/characteristics`, and that is the
 * difference from Auto. There, `property_attribute_kinds` was a dead table:
 * `properties` held zero rows and nothing read what the screen saved. Here it
 * is still live — the auction sell form, the lot detail page and
 * `lib/auction/detail.ts` all read it, and 18 lots are running. Both screens
 * are real until the auction product is retired.
 *
 * What was missing is this one: `category_attributes` drives the fixed-price
 * catalogue and had **no admin screen at all**, so the seller wizard for the
 * new product could only be changed by a developer.
 *
 *   POST { action: "category.save", id?, parent_id?, label_fr, kind, sort_order, is_active }
 *   POST { action: "category.toggle", id, is_active }
 *   POST { action: "attribute.save", id?, category_id, field_key, label, data_type,
 *          options?, unit?, required, filterable, sort_order }
 *   POST { action: "attribute.delete", id }
 */

const DATA_TYPES = new Set(["text", "number", "boolean", "select"]);
/** Land splits by what the thing IS, because it changes the questions worth
 *  asking: a plot wants "constructible", a flat wants "pièces". */
const CATEGORY_KINDS = new Set(["residential", "land", "commercial", "other"]);

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
};

/** `field_key` ends up as a jsonb key on every listing in the category, so it
 *  has to be a stable identifier rather than whatever was typed. */
function slugKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  // ── Categories ────────────────────────────────────────────────────────────
  if (action === "category.save") {
    const label = text(body.label_fr, 80);
    if (!label) {
      return NextResponse.json({ error: "invalid", detail: "Le nom est obligatoire." }, { status: 400 });
    }
    const kind = typeof body.kind === "string" && CATEGORY_KINDS.has(body.kind) ? body.kind : "residential";
    const id = text(body.id, 40);

    const patch = {
      label_fr: label,
      label_ar: text(body.label_ar, 80),
      kind,
      parent_id: text(body.parent_id, 40),
      sort_order: int(body.sort_order, 100),
      is_active: body.is_active !== false,
    };

    if (id) {
      const { error } = await admin.from("categories").update(patch).eq("id", id);
      if (error) return fail("category_update_failed", 500, error);
      logAction(req, user, "admin.category.update", { id });
      return NextResponse.json({ ok: true, id });
    }

    const { data, error } = await admin
      .from("categories")
      .insert({ ...patch, slug: slugKey(label) })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "conflict", detail: "Une catégorie porte déjà ce nom." },
          { status: 409 },
        );
      }
      return fail("category_create_failed", 500, error);
    }
    logAction(req, user, "admin.category.create", { id: data.id, label });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "category.toggle") {
    const id = text(body.id, 40);
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    const isActive = body.is_active === true;

    // Turning a category off hides its annonces from the catalog filters, so
    // say how many are affected rather than letting it happen silently.
    if (!isActive) {
      const { count } = await admin
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("category_id", id)
        .eq("status", "published");
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error: "in_use",
            detail: `${count} annonce(s) publiée(s) sont dans cette catégorie. Déplacez-les d'abord.`,
          },
          { status: 409 },
        );
      }
    }

    const { error } = await admin.from("categories").update({ is_active: isActive }).eq("id", id);
    if (error) return fail("category_toggle_failed", 500, error);

    logAction(req, user, "admin.category.toggle", { id, isActive });
    return NextResponse.json({ ok: true });
  }

  // ── Attributes ────────────────────────────────────────────────────────────
  if (action === "attribute.save") {
    const categoryId = text(body.category_id, 40);
    const label = text(body.label, 80);
    if (!categoryId || !label) {
      return NextResponse.json(
        { error: "invalid", detail: "Catégorie et libellé sont obligatoires." },
        { status: 400 },
      );
    }
    const dataType =
      typeof body.data_type === "string" && DATA_TYPES.has(body.data_type)
        ? body.data_type
        : "text";

    // Options only mean something for a select; storing them on a number field
    // is how a form ends up rendering a dropdown of nothing.
    let options: { value: string; label: string }[] | null = null;
    if (dataType === "select" && Array.isArray(body.options)) {
      options = (body.options as unknown[])
        .map((o) => {
          const row = o as { value?: unknown; label?: unknown };
          const v = text(row.value, 40) ?? slugKey(String(row.label ?? ""));
          const l = text(row.label, 60);
          return v && l ? { value: v, label: l } : null;
        })
        .filter((o): o is { value: string; label: string } => o !== null)
        .slice(0, 60);
      if (options.length === 0) {
        return NextResponse.json(
          { error: "invalid", detail: "Une liste doit avoir au moins une option." },
          { status: 400 },
        );
      }
    }

    const id = text(body.id, 40);
    const patch = {
      category_id: categoryId,
      label,
      data_type: dataType,
      options,
      unit: text(body.unit, 20),
      required: body.required === true,
      filterable: body.filterable === true,
      sort_order: int(body.sort_order, 100),
    };

    if (id) {
      // `field_key` is deliberately NOT patched: it is the jsonb key already
      // written into every listing in this category, and renaming it would
      // orphan their values without touching the data.
      const { error } = await admin.from("category_attributes").update(patch).eq("id", id);
      if (error) return fail("attribute_update_failed", 500, error);
      logAction(req, user, "admin.attribute.update", { id });
      return NextResponse.json({ ok: true, id });
    }

    const fieldKey = text(body.field_key, 40) ? slugKey(text(body.field_key, 40)!) : slugKey(label);
    if (!fieldKey) {
      return NextResponse.json({ error: "invalid", detail: "Clé invalide." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("category_attributes")
      .insert({ ...patch, field_key: fieldKey })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "conflict", detail: "Cette caractéristique existe déjà dans la catégorie." },
          { status: 409 },
        );
      }
      return fail("attribute_create_failed", 500, error);
    }
    logAction(req, user, "admin.attribute.create", { id: data.id, fieldKey });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "attribute.delete") {
    const id = text(body.id, 40);
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data: attr } = await admin
      .from("category_attributes")
      .select("id, field_key, category_id, label")
      .eq("id", id)
      .maybeSingle();
    if (!attr) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Deleting a definition does not delete the values already stored under
    // its key — it just makes them unreadable, since nothing left says what
    // `boite: auto` means. Refuse while any listing still carries one.
    const { count } = await admin
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("category_id", attr.category_id)
      .not(`attributes->>${attr.field_key}`, "is", null);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "in_use",
          detail: `${count} annonce(s) utilisent « ${attr.label} ». Retirez-la du formulaire plutôt que de la supprimer.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin.from("category_attributes").delete().eq("id", id);
    if (error) return fail("attribute_delete_failed", 500, error);

    logAction(req, user, "admin.attribute.delete", { id, fieldKey: attr.field_key });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
