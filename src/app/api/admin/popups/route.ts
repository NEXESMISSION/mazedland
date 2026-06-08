import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Admin popup CRUD — list + create.
 *
 * GET  /api/admin/popups          → all popups, newest first
 * POST /api/admin/popups          → create a new popup
 *
 * Both endpoints require admin role; the underlying `popups` RLS
 * policies double-check the same condition (defense in depth).
 */

const ROLES = ["individual", "agency", "bank", "bailiff", "inspector", "admin"] as const;
type Role = typeof ROLES[number];

const VARIANTS = ["banner", "modal", "sheet"] as const;
const MODES = ["broadcast", "rule"] as const;
const STATUSES = ["draft", "live", "paused", "archived"] as const;
const FREQUENCIES = [
  "once_per_user", "once_per_session", "every_visit", "every_n_days",
] as const;
const DEVICES = ["mobile", "desktop", "both"] as const;

async function requireAdmin() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "auth", status: 401 as const, supabase: null };
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: "forbidden", status: 403 as const, supabase: null };
  }
  return { error: null, status: 200 as const, supabase, user };
}

export async function GET() {
  const g = await requireAdmin();
  if (!g.supabase) return NextResponse.json({ error: g.error }, { status: g.status });

  const { data, error } = await g.supabase
    .from("popups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return fail("popups_fetch_failed", 500, error);
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const g = await requireAdmin();
  if (!g.supabase) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const payload = sanitizePopupBody(body);
  if (typeof payload === "string") {
    return NextResponse.json({ error: payload }, { status: 400 });
  }

  const { data, error } = await g.supabase
    .from("popups")
    .insert({ ...payload, created_by: g.user!.id })
    .select("*")
    .single();
  if (error) return fail("popup_create_failed", 500, error);
  logAction(req, g.user!, "popup.create", { slug: payload.slug });
  return NextResponse.json({ item: data });
}

/**
 * Whitelist + shape-check the incoming JSON. Returns a clean row object
 * ready to insert/update, or an error string with the failing field.
 *
 * Exported so the PATCH route can reuse it.
 */
export function sanitizePopupBody(
  body: Record<string, unknown>,
): Record<string, unknown> | string {
  const slug = typeof body.slug === "string" ? body.slug.trim().slice(0, 80) : "";
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) return "slug_invalid";

  const mode = body.mode as string | undefined;
  if (!mode || !MODES.includes(mode as typeof MODES[number])) return "mode_invalid";

  const variant = body.variant as string | undefined;
  if (!variant || !VARIANTS.includes(variant as typeof VARIANTS[number])) {
    return "variant_invalid";
  }

  // Localised text — accept { fr, ar?, en? } objects; cap each string.
  const title = sanitizeLocalised(body.title);
  if (!title || !title.fr) return "title_required";
  const bodyText = sanitizeLocalised(body.body);
  if (!bodyText) return "body_invalid";

  const image_url =
    typeof body.image_url === "string" ? body.image_url.slice(0, 500) : null;
  const icon = typeof body.icon === "string" ? body.icon.slice(0, 64) : null;

  const cta_primary = sanitizeCta(body.cta_primary);
  const cta_secondary = sanitizeCta(body.cta_secondary);

  const audience = sanitizeAudience(body.audience);
  if (typeof audience === "string") return audience;

  const pages = Array.isArray(body.pages)
    ? (body.pages as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().slice(0, 200))
        .filter((s) => s.length > 0)
        .slice(0, 50)
    : [];

  const locales = Array.isArray(body.locales)
    ? (body.locales as unknown[])
        .filter((s): s is string => s === "fr" || s === "ar" || s === "en")
    : ["fr"];

  const devices = body.devices as string | undefined;
  const cleanDevices =
    devices && DEVICES.includes(devices as typeof DEVICES[number]) ? devices : "both";

  const starts_at = typeof body.starts_at === "string" ? body.starts_at : null;
  const ends_at = typeof body.ends_at === "string" ? body.ends_at : null;

  const frequency = body.frequency as string | undefined;
  const cleanFreq =
    frequency && FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])
      ? frequency
      : "once_per_user";
  const frequency_n =
    cleanFreq === "every_n_days" && typeof body.frequency_n === "number"
      ? Math.max(1, Math.min(365, Math.floor(body.frequency_n)))
      : null;

  const dismissible = body.dismissible !== false; // default true
  const force_action = body.force_action === true;

  const priority =
    typeof body.priority === "number" ? Math.max(-100, Math.min(100, Math.floor(body.priority))) : 0;

  const status = body.status as string | undefined;
  const cleanStatus =
    status && STATUSES.includes(status as typeof STATUSES[number]) ? status : "draft";

  return {
    slug, mode, variant,
    title, body: bodyText,
    image_url, icon,
    cta_primary, cta_secondary,
    audience, pages, locales,
    devices: cleanDevices,
    starts_at, ends_at,
    frequency: cleanFreq, frequency_n,
    dismissible, force_action,
    priority, status: cleanStatus,
  };
}

function sanitizeLocalised(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const k of ["fr", "ar", "en"] as const) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim().length > 0) {
      out[k] = v.trim().slice(0, 1000);
    }
  }
  return out;
}

function sanitizeCta(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const href = typeof obj.href === "string" ? obj.href.trim().slice(0, 500) : "";
  if (!href) return null;
  const label = sanitizeLocalised(obj.label);
  if (!label || !label.fr) return null;
  const toneRaw = obj.tone as string | undefined;
  const tone = toneRaw === "secondary" || toneRaw === "ghost" ? toneRaw : "primary";
  return { label, href, tone };
}

function sanitizeAudience(
  input: unknown,
): Record<string, unknown> | string {
  if (!input || typeof input !== "object") return { scope: "all" };
  const obj = input as Record<string, unknown>;
  const scope = obj.scope as string | undefined;
  if (scope === "all") return { scope: "all" };
  if (scope === "anon") return { scope: "anon" };
  if (scope !== "logged_in") return "audience_invalid";

  const out: Record<string, unknown> = { scope: "logged_in" };
  if (Array.isArray(obj.roles)) {
    const roles = (obj.roles as unknown[]).filter(
      (r): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r),
    );
    if (roles.length > 0) out.roles = roles;
  }
  if (Array.isArray(obj.user_ids)) {
    const ids = (obj.user_ids as unknown[]).filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    ).slice(0, 500);
    if (ids.length > 0) out.user_ids = ids;
  }
  return out;
}
