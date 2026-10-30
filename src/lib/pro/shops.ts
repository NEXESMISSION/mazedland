/**
 * Mazed Immo Pro (0173): what a shop is, who may do what in it, and which plan
 * it is on. How many annonces that plan holds is counted in src/lib/places.
 *
 * The pure part (kinds, roles, rights, slugs, the form) is tested on its own;
 * the database part reads with the service role, from routes and pages that
 * have already checked who is asking.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { addMonths, monthsOf, quotePlanChange, type PlanPeriod, type PlanQuote } from "./planChange";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const SHOP_KINDS = ["agency", "promoter", "land_developer", "property_manager"] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

export const SHOP_ROLES = ["owner", "admin", "agent"] as const;
export type ShopRole = (typeof SHOP_ROLES)[number];

export const SHOP_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export type ShopAction =
  | "publish"          // put an annonce online for the shop
  | "manage_listings"  // edit or withdraw any of the shop's annonces
  | "manage_members"   // add, change or remove a member
  | "edit_shop"        // the shop's page and contacts
  | "subscribe"        // choose and pay a plan
  | "documents"        // send the papers behind « vérifié »
  | "clients"          // the visits and the client pipeline (0174)
  | "projects"         // the promoter's projects and their units (0179)
  | "leave";           // walk out of the agence (anyone added to one; never its owner)

const RIGHTS: Record<ShopRole, readonly ShopAction[]> = {
  owner: ["publish", "manage_listings", "manage_members", "edit_shop", "subscribe", "documents", "clients", "projects"],
  admin: ["publish", "manage_listings", "manage_members", "edit_shop", "clients", "projects", "leave"],
  agent: ["publish", "clients", "leave"],
};

/** Whether a member with this role may do this. The owner alone pays and sends the papers. */
export function can(role: ShopRole | null | undefined, action: ShopAction): boolean {
  return !!role && RIGHTS[role].includes(action);
}

/** Who a member may give which role: nobody makes a second owner, an admin cannot make an admin. */
export function canAssign(actor: ShopRole, role: ShopRole): boolean {
  if (role === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && role === "agent";
}

/**
 * The shop's address on the site, from its name: « Agence El Medina » →
 * agence-el-medina. A name with no Latin letters (Arabic) gets a neutral slug
 * the owner can change later.
 */
export function slugify(name: string, fallbackSuffix: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `agence-${fallbackSuffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

export type ShopInput = {
  name: string;
  kind: ShopKind;
  description: string | null;
  governorate: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours: string | null;
  legal_name: string | null;
  legal_id: string | null;
  logo_path: string | null;
  cover_path: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
};

/** A storage path the photo route minted for this user, or null. */
const ownPath = (v: unknown, userId: string): string | null => {
  const p = text(v, 300);
  return p && p.startsWith(`${userId}/`) && !p.includes("..") ? p : null;
};

/** The shop form, checked. Errors name the field; the route words them. */
export function parseShopInput(
  raw: Record<string, unknown>,
  userId: string,
): { ok: true; value: ShopInput } | { ok: false; error: "name" | "kind" | "governorate" | "phone" | "email" | "website" } {
  const name = text(raw.name, 80);
  if (!name || name.length < 2) return { ok: false, error: "name" };
  const kind = SHOP_KINDS.find((k) => k === raw.kind);
  if (!kind) return { ok: false, error: "kind" };
  const governorate = TUNISIAN_GOVERNORATES.find((g) => g === raw.governorate);
  if (!governorate) return { ok: false, error: "governorate" };

  const phoneRaw = text(raw.phone, 24);
  const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, "") : null;
  if (phone && phone.replace(/\D/g, "").length < 8) return { ok: false, error: "phone" };
  const email = text(raw.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email" };
  const websiteRaw = text(raw.website, 200);
  const website = websiteRaw ? (/^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`) : null;
  if (website && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(website)) return { ok: false, error: "website" };

  return {
    ok: true,
    value: {
      name,
      kind,
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim().slice(0, 2000) : null,
      governorate,
      city: text(raw.city, 80),
      phone,
      email,
      website,
      hours: text(raw.hours, 200),
      legal_name: text(raw.legal_name, 120),
      legal_id: text(raw.legal_id, 60),
      logo_path: ownPath(raw.logo_path, userId),
      cover_path: ownPath(raw.cover_path, userId),
    },
  };
}

// ── Database ──────────────────────────────────────────────────────────────

export type ShopRow = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  kind: ShopKind;
  description: string | null;
  logo_path: string | null;
  cover_path: string | null;
  governorate: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours: string | null;
  legal_name: string | null;
  legal_id: string | null;
  status: ShopStatus;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
};

export const SHOP_COLUMNS =
  "id, owner_id, slug, name, kind, description, logo_path, cover_path, governorate, city, phone, email, website, hours, legal_name, legal_id, status, rejection_reason, verified_at, created_at";

/** The shops this person belongs to, with their role. */
export async function membershipsOf(admin: Admin, userId: string): Promise<{ shop: ShopRow; role: ShopRole }[]> {
  const { data } = await admin
    .from("shop_members")
    .select(`role, shop:shops (${SHOP_COLUMNS})`)
    .eq("user_id", userId);
  return ((data ?? []) as unknown as { role: ShopRole; shop: ShopRow | ShopRow[] | null }[])
    .map((m) => ({ role: m.role, shop: Array.isArray(m.shop) ? m.shop[0] : m.shop }))
    .filter((m): m is { shop: ShopRow; role: ShopRole } => !!m.shop);
}

/** This person's role in this shop, or null. */
export async function roleIn(admin: Admin, shopId: string, userId: string): Promise<ShopRole | null> {
  const { data } = await admin
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as ShopRole | undefined) ?? null;
}

export type ActivePlan = { subscriptionId: string; productId: string; name: string; quota: number; endsAt: string };

/**
 * The plan paid for right now, if any: of the periods that cover today, the
 * biggest one. An upgrade starts at once and can run beside the smaller
 * period it replaces (or a renewal of it already paid for); the bigger plan
 * is the one that applies.
 */
export async function activePlan(admin: Admin, shopId: string, now: Date = new Date()): Promise<ActivePlan | null> {
  const iso = now.toISOString();
  const { data } = await admin
    .from("shop_subscriptions")
    .select("id, product_id, listing_quota, ends_at, product:products (name_fr)")
    .eq("shop_id", shopId)
    .eq("status", "active")
    .lte("starts_at", iso)
    .gt("ends_at", iso)
    .order("listing_quota", { ascending: false })
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const product = (Array.isArray(data.product) ? data.product[0] : data.product) as { name_fr: string } | null;
  return {
    subscriptionId: data.id as string,
    productId: data.product_id as string,
    name: product?.name_fr ?? "",
    quota: data.listing_quota as number,
    endsAt: data.ends_at as string,
  };
}

/**
 * When a newly paid period starts. A bigger plan than the one running starts
 * at once (the owner's choice, 2026-10-27): the agence gets its room the day
 * the receipt is accepted. The same plan, or a smaller one, follows what is
 * already paid for at that level or above — renewing early never cuts the
 * running period short, and a smaller plan queued behind does not push the
 * start back (it is replaced instead, see grantPlanPeriod).
 */
export function periodStart(input: {
  now: Date;
  /** Annonces the plan being paid for allows. */
  quota: number;
  /** The plan running now, if any. */
  runningQuota: number | null;
  /** The end of the last period already paid for, of this plan or a bigger one, if it is still ahead. */
  paidUntil: Date | null;
}): Date {
  if (input.runningQuota !== null && input.quota > input.runningQuota) return input.now;
  return input.paidUntil && input.paidUntil > input.now ? input.paidUntil : input.now;
}

/** When a new period of a plan of `quota` annonces starts for this shop (periodStart). */
export async function nextPeriodStart(admin: Admin, shopId: string, quota: number, now: Date = new Date()): Promise<Date> {
  const [running, { data }] = await Promise.all([
    activePlan(admin, shopId, now),
    admin
      .from("shop_subscriptions")
      .select("ends_at")
      .eq("shop_id", shopId)
      .eq("status", "active")
      .gte("listing_quota", quota)
      .gt("ends_at", now.toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return periodStart({
    now,
    quota,
    runningQuota: running?.quota ?? null,
    paidUntil: data ? new Date(data.ends_at as string) : null,
  });
}


export type PaidPeriod = { id: string; quota: number; startsAt: Date; endsAt: Date };

/**
 * What a new period takes over from the smaller periods still ahead of its
 * start (`now`; the owner's choice, 2026-10-27): their remaining time is
 * added to the new plan, and they end — one running at that moment ends
 * then, one wholly ahead is cancelled. Periods of the same plan or a bigger
 * one are left as they are.
 */
export function carryOver(input: { now: Date; quota: number; periods: PaidPeriod[] }): {
  carriedMs: number;
  endNow: string[];
  cancel: string[];
} {
  const now = input.now.getTime();
  let carriedMs = 0;
  const endNow: string[] = [];
  const cancel: string[] = [];
  for (const p of input.periods) {
    const end = p.endsAt.getTime();
    if (p.quota >= input.quota || end <= now) continue;
    const start = Math.max(p.startsAt.getTime(), now);
    carriedMs += end - start;
    (p.startsAt.getTime() < now ? endNow : cancel).push(p.id);
  }
  return { carriedMs, endNow, cancel };
}

/**
 * The shop's periods still ahead, with what each plan costs and whether it
 * was paid for — what quotePlanChange needs (src/lib/pro/planChange.ts).
 */
export async function loadPlanPeriods(admin: Admin, shopId: string, now: Date = new Date()): Promise<PlanPeriod[]> {
  const { data } = await admin
    .from("shop_subscriptions")
    .select("id, listing_quota, starts_at, ends_at, payment_id, product:products (price), payment:payments (status)")
    .eq("shop_id", shopId)
    .eq("status", "active")
    .gt("ends_at", now.toISOString());
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  return ((data ?? []) as unknown as {
    id: string; listing_quota: number; starts_at: string; ends_at: string; payment_id: string | null;
    product: { price: number | string } | { price: number | string }[] | null;
    payment: { status: string } | { status: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    quota: r.listing_quota,
    price: Number(one(r.product)?.price ?? 0),
    paid: !!r.payment_id && one(r.payment)?.status === "captured",
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
  }));
}

/** What choosing this plan would mean for this shop today: price, discount, dates (quotePlanChange). */
export async function quoteForShop(
  admin: Admin,
  shopId: string,
  plan: { listing_quota: number; price: number | string; duration_days: number | null },
  renewDays: number,
  now: Date = new Date(),
): Promise<PlanQuote> {
  return quotePlanChange({
    now,
    target: { quota: plan.listing_quota, price: Number(plan.price), months: monthsOf(Number(plan.duration_days)) },
    periods: await loadPlanPeriods(admin, shopId, now),
    renewDays,
  });
}

/**
 * One paid period of a plan, as « Accepter » in the payment queue grants it:
 * starting by periodStart. The payment id is unique on the period, so the same
 * receipt never grants twice, and a second call changes nothing.
 *
 * The smaller periods still ahead when the new one starts are replaced (one
 * running then ends at that moment, one paid in advance is cancelled): an
 * upgrade replaces the running plan, a renewal or a bigger plan queued for
 * later replaces a smaller one queued behind it. Since 2026-10-28 the time
 * they had left was taken off the price (quotePlanChange), so the new period
 * is one plan length — the same day next month. A payment made before that
 * rule (`legacy`: no `change` in its metadata) paid full price and still gets
 * the days left added (carryOver), as it was promised.
 *
 * Each replaced period remembers which payment replaced it and the end it
 * had (`replaced_by`, `ends_at_before`, 0193): a credit note on that payment
 * gives the periods back (issue_credit_note) — on 2026-10-30 refunding an
 * upgrade left the agence with no plan at all, the Starter month it had paid
 * cut short for nothing.
 */
export async function grantPlanPeriod(
  admin: Admin,
  g: { shopId: string; productId: string; paymentId: string; quota: number; days: number; grantedBy: string; legacy?: boolean },
  now: Date = new Date(),
): Promise<{ startsAt: Date; endsAt: Date; carriedDays: number } | { error: unknown }> {
  const starts = await nextPeriodStart(admin, g.shopId, g.quota, now);
  const { data: smaller } = await admin
    .from("shop_subscriptions")
    .select("id, listing_quota, starts_at, ends_at")
    .eq("shop_id", g.shopId)
    .eq("status", "active")
    .lt("listing_quota", g.quota)
    .gt("ends_at", starts.toISOString());
  const replaced = (smaller ?? []).map((p) => ({
    id: p.id as string,
    quota: p.listing_quota as number,
    startsAt: new Date(p.starts_at as string),
    endsAt: new Date(p.ends_at as string),
  }));
  const carry = carryOver({ now: starts, quota: g.quota, periods: replaced });
  const ends = g.legacy
    ? new Date(starts.getTime() + g.days * 86_400_000 + carry.carriedMs)
    : addMonths(starts, monthsOf(g.days));
  if (!g.legacy) carry.carriedMs = 0;
  const { data: inserted, error } = await admin
    .from("shop_subscriptions")
    .upsert(
      {
        shop_id: g.shopId,
        product_id: g.productId,
        payment_id: g.paymentId,
        listing_quota: g.quota,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        granted_by: g.grantedBy,
      },
      { onConflict: "payment_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { error };
  // Already granted by this payment: nothing to move twice.
  if (!inserted || inserted.length === 0) return { startsAt: starts, endsAt: ends, carriedDays: 0 };
  // One at a time: each keeps its own end, for the credit note that would undo this.
  for (const id of carry.endNow) {
    const before = replaced.find((p) => p.id === id)?.endsAt ?? null;
    const { error: e } = await admin
      .from("shop_subscriptions")
      .update({ ends_at: starts.toISOString(), ends_at_before: before?.toISOString() ?? null, replaced_by: g.paymentId })
      .eq("id", id);
    if (e) return { error: e };
  }
  if (carry.cancel.length) {
    const { error: e } = await admin.from("shop_subscriptions").update({ status: "cancelled", replaced_by: g.paymentId }).in("id", carry.cancel);
    if (e) return { error: e };
  }
  return { startsAt: starts, endsAt: ends, carriedDays: Math.round(carry.carriedMs / 86_400_000) };
}
