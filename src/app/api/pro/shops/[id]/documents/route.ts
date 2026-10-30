import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";

/**
 * The papers behind « vérifié » (0173), in the private `shop-documents`
 * bucket. Only the shop's owner sends them; only the owner and the admins
 * read them, through short-lived signed links.
 *
 *   POST { step: "url", ext }                      → a signed upload URL and its path
 *   POST { step: "save", path, kind, fileName }    → the document recorded
 */
const KINDS = ["rne", "patente", "identity", "other"] as const;
const EXT = /^(pdf|jpg|jpeg|png|webp)$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "documents" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");
  const body = await jsonObject(req);

  if (body.step === "url") {
    const { data: over } = await admin.rpc("check_rate_limit", { p_key: `shop-doc:${user.id}`, p_max: 30, p_window_secs: 3600 });
    if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const ext = String(body.ext ?? "").toLowerCase();
    if (!EXT.test(ext)) return NextResponse.json({ error: "invalid", detail: t("errors.fileType") }, { status: 400 });
    const path = `${id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const { data, error } = await admin.storage.from("shop-documents").createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return fail("signed_url_failed", 500, error);
    return NextResponse.json({ ok: true, path, signedUrl: data.signedUrl });
  }

  if (body.step === "save") {
    const path = typeof body.path === "string" ? body.path : "";
    const kind = KINDS.find((k) => k === body.kind);
    if (!kind || !path.startsWith(`${id}/`) || path.includes("..")) {
      return NextResponse.json({ error: "invalid", detail: t("errors.document") }, { status: 400 });
    }
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 160) : null;
    const { error } = await admin.from("shop_documents").insert({ shop_id: id, kind, storage_path: path, file_name: fileName, uploaded_by: user.id });
    if (error) return fail("document_save_failed", 500, error);
    logAction(req, user, "shop.document", { id, kind });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid" }, { status: 400 });
}
