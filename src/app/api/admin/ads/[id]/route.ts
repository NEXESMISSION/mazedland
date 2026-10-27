import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { apiTranslator } from "@/lib/i18n/server";
import { parseAdInput } from "@/lib/ads/input";

/**
 * One campaign.
 *
 *   PATCH  → change it. Only the fields sent are touched: `{ active: false }`
 *            is « Mettre en pause », the whole form is « Enregistrer ».
 *   DELETE → remove it, with its days (`ad_daily` cascades) and its images.
 *            Pausing keeps the report; deleting is for a campaign entered by
 *            mistake, which is why the console asks first.
 *
 * An image the edit replaced is removed from storage: the paths are unique
 * per upload, so nothing else points at it.
 */
type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Images = { image_path: string | null; image_mobile_path: string | null };

async function readImages(admin: NonNullable<ReturnType<typeof getServiceSupabase>>, id: string) {
  const { data } = await admin.from("ads").select("image_path, image_mobile_path").eq("id", id).maybeSingle();
  return (data as Images | null) ?? null;
}

/** Best effort: a file left behind costs a few kilobytes, never a failed save. */
function removeFiles(admin: NonNullable<ReturnType<typeof getServiceSupabase>>, paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => typeof p === "string" && p.startsWith("ads/"));
  if (list.length === 0) return;
  void admin.storage
    .from("properties")
    .remove(list)
    .then(({ error }) => {
      if (error) log.scope("ads").warn("ad image not removed", { msg: error.message });
    });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireAdmin(req, "publicites");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseAdInput(body, { partial: true });
  if (!parsed.ok) {
    const t = await apiTranslator(req, "adminAds.api");
    return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
  }
  const patch = parsed.value;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const before = await readImages(admin, id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await admin.from("ads").update(patch).eq("id", id);
  if (error) {
    // 23514: a CHECK from 0177 the parser did not foresee — say « invalid »
    // rather than « server error », it is the form that has to change.
    if (error.code === "23514") return NextResponse.json({ error: "invalid" }, { status: 400 });
    return fail("ad_update_failed", 500, error);
  }

  const replaced = [
    "image_path" in patch && patch.image_path !== before.image_path ? before.image_path : null,
    "image_mobile_path" in patch && patch.image_mobile_path !== before.image_mobile_path ? before.image_mobile_path : null,
  ];
  removeFiles(admin, replaced);

  // The switch alone is its own gesture in the journal: « mise en pause »
  // reads better than « modifiée » when an advertiser asks why it stopped.
  const keys = Object.keys(patch);
  if (keys.length === 1 && keys[0] === "active") {
    if (patch.active) logAction(req, user, "admin.ad.resume", { id });
    else logAction(req, user, "admin.ad.pause", { id });
  } else {
    logAction(req, user, "admin.ad.update", { id, keys });
  }
  return NextResponse.json({ ok: true, updated: 1 });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireAdmin(req, "publicites");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data, error } = await admin
    .from("ads")
    .delete()
    .eq("id", id)
    .select("advertiser, image_path, image_mobile_path, views, clicks")
    .maybeSingle();
  if (error) return fail("ad_delete_failed", 500, error);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  removeFiles(admin, [data.image_path, data.image_mobile_path]);
  // The totals go into the journal: they are the last trace of the campaign.
  logAction(req, user, "admin.ad.delete", {
    id,
    advertiser: data.advertiser,
    views: data.views,
    clicks: data.clicks,
  });
  return NextResponse.json({ ok: true });
}
