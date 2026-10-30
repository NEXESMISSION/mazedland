import { NextRequest, NextResponse } from "next/server";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * The answer when the place could not be taken (takePlace, 0190): the
 * annonce moved meanwhile — a double tap, a stale tab — or an admin took it
 * down, in which case the seller is told to contact the team rather than
 * handed a way round the decision.
 */
export async function placeRefusal(req: NextRequest, reason: "not_submittable" | "taken_down"): Promise<NextResponse> {
  const t = await apiTranslator(req, "accountApi.status");
  if (reason === "taken_down") {
    return NextResponse.json({ error: "taken_down", detail: t("refusal.takenDown") }, { status: 403 });
  }
  return NextResponse.json({ error: "not_submittable", detail: t("refusal.relist") }, { status: 409 });
}

/**
 * The agence's plan has no place left. Said as such: an agence told « vos 2
 * annonces gratuites sont déjà en ligne » and sent to the Pro marketing page
 * was the QA tour's finding.
 */
export async function planFullResponse(req: NextRequest, limit: number): Promise<NextResponse> {
  const t = await apiTranslator(req, "publishApi");
  return NextResponse.json({ error: "plan_full", limit, detail: t("planFull", { limit }) }, { status: 402 });
}
