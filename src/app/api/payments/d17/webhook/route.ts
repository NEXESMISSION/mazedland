import { NextRequest, NextResponse } from "next/server";

/**
 * D17 (Poste Tunisienne) webhook.
 *
 * The D17 integration is bank-issued — endpoints, signing scheme, and
 * callback payload are specified per merchant in the Poste Tunisienne
 * onboarding kit. Until we have that kit signed we cannot implement the
 * verification step, and accepting an unauthenticated callback would
 * let anyone flip our payments to captured.
 *
 * This route exists so the URL is reachable (avoids 404s during
 * Postman / smoke tests) but it deliberately fails closed.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: "d17_webhook_not_yet_wired" },
    { status: 501 },
  );
}
export const GET = POST;
