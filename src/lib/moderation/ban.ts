import { NextRequest, NextResponse } from "next/server";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { apiTranslator } from "@/lib/i18n/server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * The console's « Suspendre » promised « le vendeur ne pourra plus publier »,
 * and nothing enforced it: `profiles.banned_at` only kept the account out of
 * automatic approval, so a suspended seller still created, submitted, edited
 * and even relisted annonces (the QA tour, 2026-10-29). Every route that
 * writes an annonce for a seller asks here first.
 *
 * Returns the 403 to send, or null when the account may go on.
 */
export async function suspendedResponse(admin: Admin, req: NextRequest, userId: string): Promise<NextResponse | null> {
  const { data } = await admin.from("profiles").select("banned_at").eq("id", userId).maybeSingle();
  if (!data?.banned_at) return null;
  const t = await apiTranslator(req, "publishApi");
  return NextResponse.json({ error: "account_suspended", detail: t("accountSuspended") }, { status: 403 });
}
