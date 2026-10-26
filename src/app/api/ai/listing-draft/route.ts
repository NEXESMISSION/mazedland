import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { categoryLabel } from "@/lib/i18n";
import { redactContacts } from "@/lib/moderation/rules";
import { callJson } from "@/lib/ai/server";
import { buildSystemPrompt, LISTING_DRAFT_SCHEMA, normalizeListingDraft, type DraftCategory } from "@/lib/ai/listing";

/**
 * POST /api/ai/listing-draft  { text }
 *
 * The seller's sentence → a draft of the annonce (src/lib/ai/listing.ts). The
 * text is stripped of numbers, e-mails and links before it leaves the site;
 * the answer is checked against the site's own lists before it is returned;
 * nothing is saved — the wizard fills its fields and the seller reviews every
 * step. When the AI is unavailable (no key, switched off, budget spent) this
 * says so and the form works exactly as before.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "aiApi");

  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const source = typeof body.text === "string" ? body.text.trim().slice(0, 800) : "";
  if (source.length < 12) {
    return NextResponse.json({ error: "too_short", detail: t("tooShort") }, { status: 400 });
  }

  // Twenty drafts an hour is more than any seller writes; it caps the cost of
  // an account scripted to call this in a loop.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `ai-draft:${user.id}`,
    p_max: 20,
    p_window_secs: 3600,
  });
  if (over === true) {
    return NextResponse.json({ error: "rate_limited", detail: t("rateLimited") }, { status: 429 });
  }

  const { data: catRows } = await admin
    .from("categories")
    .select("slug, label_fr, label_ar, kind, parent_id")
    .eq("is_active", true);
  const categories: DraftCategory[] = (catRows ?? [])
    .filter((c) => c.parent_id != null)
    .map((c) => ({
      slug: c.slug as string,
      label: categoryLabel(c as { label_fr: string; label_ar: string | null }, "fr"),
      kind: c.kind as string,
    }));

  const out = await callJson({
    admin,
    userId: user.id,
    feature: "listing_draft",
    system: buildSystemPrompt(categories),
    user: redactContacts(source),
    schema: LISTING_DRAFT_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!out.ok) {
    return NextResponse.json(
      { error: out.reason === "unavailable" ? "ai_unavailable" : "ai_failed", detail: t(out.reason === "unavailable" ? "unavailable" : "failed") },
      { status: out.reason === "unavailable" ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, draft: normalizeListingDraft(out.data, { categories, sourceText: source }) });
}
