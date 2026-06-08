import { NextResponse } from "next/server";
import type { getServerSupabase } from "@/lib/supabase/server";
import { fail } from "@/lib/http/errors";

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** A claim is considered abandoned after this long, so another admin can take over. */
export const CLAIM_TTL_MS = 15 * 60 * 1000;

export type ClaimTable = "kyc_submissions" | "seller_payouts";

/**
 * Advisory "claim / assigned-to-me" handler shared by the admin work-queue
 * PATCH endpoints. Lets one admin reserve a FIFO row so a second admin
 * doesn't review the same item.
 *
 * Returns a NextResponse when `action` is "claim" or "release" (the caller
 * should return it immediately); returns null otherwise so the caller falls
 * through to its normal decision logic.
 *
 * Claiming is atomic: the UPDATE only matches when the row is free, already
 * mine, or held by a stale claim past CLAIM_TTL_MS — so two simultaneous
 * claims can't both win. Decisions auto-clear the claim via DB trigger.
 */
export async function handleClaim(
  supabase: ServerSupabase,
  table: ClaimTable,
  id: string,
  userId: string,
  action: unknown,
): Promise<NextResponse | null> {
  if (action !== "claim" && action !== "release") return null;

  if (action === "release") {
    // Only the holder can release (no-op otherwise).
    await supabase
      .from(table)
      .update({ claimed_by: null, claimed_at: null })
      .eq("id", id)
      .eq("claimed_by", userId);
    return NextResponse.json({ ok: true, claimed_by: null });
  }

  const staleIso = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from(table)
    .update({ claimed_by: userId, claimed_at: nowIso })
    .eq("id", id)
    .or(`claimed_by.is.null,claimed_by.eq.${userId},claimed_at.lt.${staleIso}`)
    .select("id, claimed_by, claimed_at");

  if (error) return fail("claim_failed", 500, error);
  if (!updated || updated.length === 0) {
    // Someone else holds a fresh claim.
    const { data: cur } = await supabase
      .from(table)
      .select("claimed_by")
      .eq("id", id)
      .single();
    return NextResponse.json(
      { error: "already_claimed", claimed_by: (cur as { claimed_by?: string } | null)?.claimed_by ?? null },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, claimed_by: userId, claimed_at: nowIso });
}
