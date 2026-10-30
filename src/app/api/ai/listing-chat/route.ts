import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { apiTranslator } from "@/lib/i18n/server";
import { categoryLabel } from "@/lib/i18n";
import { redactContacts } from "@/lib/moderation/rules";
import { callJson } from "@/lib/ai/server";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_TURNS,
  CHAT_MAX_TURN_CHARS,
  LISTING_CHAT_SCHEMA,
  buildChatSystemPrompt,
  chatReply,
  chatTranscript,
  normalizeListingDraft,
  splitTurn,
  type ChatTurn,
  type DraftCategory,
} from "@/lib/ai/listing";

/**
 * POST /api/ai/listing-chat  { turns: [{ role: "seller" | "assistant", text }] }
 *
 * « Publier en parlant » (version B of the publish flow): the conversation so
 * far → the whole annonce as understood now, what to say next, and whether
 * the seller asked to publish. Same guards as /api/ai/listing-draft: signed
 * in, numbers / e-mails / links stripped before anything leaves the site, the
 * answer checked against the site's own lists, nothing saved here — the page
 * saves and submits through the ordinary routes when the seller presses
 * « Publier ».
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

  const body = await jsonObject(req);
  const turns: ChatTurn[] = (Array.isArray(body.turns) ? body.turns : [])
    .filter(
      (x): x is ChatTurn =>
        !!x && typeof x === "object" &&
        ((x as ChatTurn).role === "seller" || (x as ChatTurn).role === "assistant") &&
        typeof (x as ChatTurn).text === "string",
    )
    // The seller's words are redacted; the assistant's were written by the
    // model. A dictated message longer than a turn is read as several turns,
    // not cut to the first: the price is usually said last.
    .flatMap((x): ChatTurn[] =>
      x.role === "seller"
        ? splitTurn(redactContacts(x.text.slice(0, CHAT_MAX_MESSAGE_CHARS))).map((text) => ({ role: "seller", text }))
        : [{ role: "assistant", text: x.text.trim().slice(0, CHAT_MAX_TURN_CHARS) }],
    )
    .filter((x) => x.text)
    .slice(-CHAT_MAX_TURNS);

  const said = turns.filter((x) => x.role === "seller").map((x) => x.text).join("\n");
  if (said.length < 4 || turns[turns.length - 1]?.role !== "seller") {
    return NextResponse.json({ error: "too_short", detail: t("tooShort") }, { status: 400 });
  }

  // A conversation takes more turns than one sentence: sixty an hour covers
  // several annonces and still caps an account scripted to call this in a loop.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `ai-chat:${user.id}`,
    p_max: 60,
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
    feature: "listing_chat",
    system: buildChatSystemPrompt(categories),
    user: chatTranscript(turns),
    schema: LISTING_CHAT_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!out.ok) {
    return NextResponse.json(
      { error: out.reason === "unavailable" ? "ai_unavailable" : "ai_failed", detail: t(out.reason === "unavailable" ? "unavailable" : "failed") },
      { status: out.reason === "unavailable" ? 503 : 502 },
    );
  }

  const { reply, wantsToPublish } = chatReply(out.data);
  return NextResponse.json({
    ok: true,
    draft: normalizeListingDraft(out.data, { categories, sourceText: said }),
    reply,
    wantsToPublish,
  });
}
