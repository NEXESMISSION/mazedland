// ============================================================================
// Shared fixtures + client helpers for the money/auction RPC integration suite.
//
// These tests run against a REAL local Supabase Postgres (the throwaway stack
// brought up by `supabase start`) so the SECURITY DEFINER PL/pgSQL RPCs that
// move money — place_bid, close_auction_on_purchase, seller_earnings,
// seller_balance, request_payout — execute with their real grants, RLS, the
// _on_payment_captured trigger, the _guard_payment_capture trigger, and the
// auth.uid()/auth.jwt() machinery. A bare postgres:16 cannot run them; only the
// Supabase local stack applies supabase/migrations/** in full.
//
// Connection facts come from the environment (the CI job exports them out of
// `supabase status`):
//   SUPABASE_URL  (or NEXT_PUBLIC_SUPABASE_URL)         — http://127.0.0.1:54321
//   SUPABASE_SERVICE_ROLE_KEY                           — local service-role JWT
//   SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)— local anon JWT
//
// The service-role client bypasses RLS and both payment guards, so it is the
// only thing allowed to seed `captured` payments — exactly mirroring the
// production capture path (admin/manual-payment routes use the service role).
// User-scoped RPCs (place_bid, request_payout, seller_earnings) are exercised
// through per-user signed-in clients so auth.uid() / auth.jwt() resolve.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function requireEnv(): { url: string; serviceKey: string; anonKey: string } {
  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length) {
    throw new Error(
      `Missing env for RPC integration tests: ${missing.join(", ")}.\n` +
        `Run \`supabase start\` then export the printed URL + keys (see tests/rpc/README runbook).`,
    );
  }
  return { url, serviceKey, anonKey };
}

/** Service-role client — bypasses RLS + the payment-capture guard. Seeds + cleans up. */
export function admin(): SupabaseClient {
  const env = requireEnv();
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A fresh ANON client (no session). */
export function anon(): SupabaseClient {
  const env = requireEnv();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const PASSWORD = "RpcTest!2026x";

export type TestUser = {
  id: string;
  email: string;
  /** A signed-in (role=authenticated) client whose auth.uid() === id. */
  client: SupabaseClient;
};

/**
 * Create a confirmed auth user (the on_auth_user_created trigger mirrors the
 * public.profiles row), then sign in a dedicated client for it. `role: 'admin'`
 * also lands an app_metadata.role=admin claim so is_admin() is true on the JWT.
 */
export async function createUser(
  svc: SupabaseClient,
  opts: { kyc?: "verified" | "none"; role?: "individual" | "admin" } = {},
): Promise<TestUser> {
  const env = requireEnv();
  const email = `rpc-${randomUUID()}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    // The on_auth_user_created trigger reads raw_user_meta_data.role; passing
    // role=admin also mirrors app_metadata.role=admin → is_admin() === true.
    user_metadata: { full_name: "RPC Test", role: opts.role ?? "individual" },
  });
  if (error || !data.user) {
    throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  }
  const id = data.user.id;

  // KYC is admin-only in prod; here we set it directly via service-role so the
  // user can clear place_bid's kyc_required gate.
  if (opts.kyc === "verified") {
    const { error: kErr } = await svc
      .from("profiles")
      .update({ kyc_status: "verified", kyc_verified_at: new Date().toISOString() })
      .eq("id", id);
    if (kErr) throw new Error(`set kyc_verified failed: ${kErr.message}`);
  }

  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (sErr) throw new Error(`sign-in failed for ${email}: ${sErr.message}`);

  return { id, email, client };
}

/** Delete the users (cascades to profiles + their owned data via FKs). */
export async function deleteUsers(svc: SupabaseClient, users: TestUser[]): Promise<void> {
  for (const u of users) {
    await svc.auth.admin.deleteUser(u.id).catch(() => {});
  }
}

export type SeedAuctionOpts = {
  ownerId: string;
  type?: "english" | "sealed" | "dutch";
  listingType?: "auction" | "direct";
  status?: string;
  openingPrice?: number;
  reservePrice?: number | null;
  buyNowPrice?: number | null;
  salePrice?: number | null;
  currentPrice?: number | null;
  winnerUserId?: string | null;
  winnerAmount?: number | null;
  /** seconds from now; negative = in the past (already started/ended). */
  startsInSeconds?: number;
  endsInSeconds?: number;
  extendWindowSeconds?: number;
  extendBySeconds?: number;
};

export type SeededAuction = {
  propertyId: string;
  auctionId: string;
};

/**
 * Seed a property + auction owned by `ownerId`, both via service-role (RLS off).
 * Returns the ids. Property is created at 'ready' so any auctions_public_read
 * path resolves, though the RPCs read it via SECURITY DEFINER regardless.
 */
export async function seedAuction(
  svc: SupabaseClient,
  opts: SeedAuctionOpts,
): Promise<SeededAuction> {
  const now = Date.now();
  const startsAt = new Date(now + (opts.startsInSeconds ?? -3600) * 1000).toISOString();
  const endsAt = new Date(now + (opts.endsInSeconds ?? 3600) * 1000).toISOString();

  const { data: prop, error: pErr } = await svc
    .from("properties")
    .insert({
      owner_id: opts.ownerId,
      title: `RPC Test Property ${randomUUID().slice(0, 8)}`,
      type: "apartment",
      governorate: "Tunis",
      status: "ready",
    })
    .select("id")
    .single();
  if (pErr || !prop) throw new Error(`seed property failed: ${pErr?.message}`);

  const listingType = opts.listingType ?? "auction";
  const row: Record<string, unknown> = {
    property_id: prop.id,
    type: opts.type ?? "english",
    listing_type: listingType,
    opening_price: opts.openingPrice ?? 100000,
    reserve_price: opts.reservePrice ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: opts.status ?? "live",
    current_price: opts.currentPrice ?? null,
    winner_user_id: opts.winnerUserId ?? null,
    winner_amount: opts.winnerAmount ?? null,
    extend_window_seconds: opts.extendWindowSeconds ?? 300,
    extend_by_seconds: opts.extendBySeconds ?? 600,
  };
  // Honor the listing_type CHECK constraints: direct needs sale_price + no
  // buy_now; auction must have sale_price NULL.
  if (listingType === "direct") {
    row.sale_price = opts.salePrice ?? 150000;
  } else {
    row.sale_price = null;
    if (opts.buyNowPrice != null) row.buy_now_price = opts.buyNowPrice;
  }

  const { data: auc, error: aErr } = await svc
    .from("auctions")
    .insert(row)
    .select("id")
    .single();
  if (aErr || !auc) throw new Error(`seed auction failed: ${aErr?.message}`);

  return { propertyId: prop.id, auctionId: auc.id };
}

/**
 * Materialize an ACTIVE deposit for a bidder by inserting a captured
 * deposit_lock payment via service-role — this fires _on_payment_captured,
 * which upserts the auction_deposits row exactly like the production path.
 * Returns the payment id.
 */
export async function captureDeposit(
  svc: SupabaseClient,
  args: { userId: string; auctionId: string; amount: number },
): Promise<string> {
  const { data, error } = await svc
    .from("payments")
    .insert({
      user_id: args.userId,
      kind: "deposit_lock",
      provider: "manual",
      amount: args.amount,
      status: "captured",
      auction_id: args.auctionId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`captureDeposit failed: ${error?.message}`);
  return data.id;
}

/**
 * Insert a captured purchase payment (buy_now | final_payment) via service-role.
 * Fires _on_payment_captured → close_auction_on_purchase. Returns the payment id
 * (or the error if the unique index / trigger rejected it, for negative tests).
 */
export async function capturePurchase(
  svc: SupabaseClient,
  args: {
    userId: string;
    auctionId: string;
    amount: number;
    kind: "buy_now" | "final_payment";
  },
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await svc
    .from("payments")
    .insert({
      user_id: args.userId,
      kind: args.kind,
      provider: "manual",
      amount: args.amount,
      status: "captured",
      auction_id: args.auctionId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data!.id };
}

/** Read a single auction row (service-role, RLS bypassed). */
export async function getAuction(svc: SupabaseClient, auctionId: string) {
  const { data, error } = await svc
    .from("auctions")
    .select("*")
    .eq("id", auctionId)
    .single();
  if (error) throw new Error(`getAuction failed: ${error.message}`);
  return data;
}

/** Force an auction into a given status/winner via service-role. */
export async function setAuction(
  svc: SupabaseClient,
  auctionId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await svc.from("auctions").update(patch).eq("id", auctionId);
  if (error) throw new Error(`setAuction failed: ${error.message}`);
}

/** Mark a captured deposit as forfeited (the forfeit path used by 0094 dedup). */
export async function forfeitDeposit(
  svc: SupabaseClient,
  args: { userId: string; auctionId: string },
) {
  const { error } = await svc
    .from("auction_deposits")
    .update({ forfeited_at: new Date().toISOString() })
    .eq("auction_id", args.auctionId)
    .eq("user_id", args.userId);
  if (error) throw new Error(`forfeitDeposit failed: ${error.message}`);
}

/** Sum the net_amount that seller_earnings credits for an auction. */
export function netForAuction(
  rows: Array<{ auction_id: string; net_amount: number | string }>,
  auctionId: string,
): number {
  return rows
    .filter((r) => r.auction_id === auctionId)
    .reduce((s, r) => s + Number(r.net_amount), 0);
}

/** Count seller_earnings line items for an auction. */
export function rowsForAuction(
  rows: Array<{ auction_id: string }>,
  auctionId: string,
): number {
  return rows.filter((r) => r.auction_id === auctionId).length;
}
