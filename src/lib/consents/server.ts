import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { ConsentKind, ConsentRow, ConsentSource } from "./model";

const cLog = log.scope("consents");

/**
 * Records answers in `user_consents` (service role: the table takes no
 * writes from a browser). Never throws: a consent that fails to save is
 * logged, and the action it came with (a signup, an SMS switch) still stands.
 */
export async function recordConsents(
  admin: SupabaseClient,
  userId: string,
  answers: readonly { kind: ConsentKind; granted: boolean }[],
  version: string,
  source: ConsentSource,
): Promise<boolean> {
  if (answers.length === 0) return true;
  const { error } = await admin
    .from("user_consents")
    .insert(answers.map((a) => ({ user_id: userId, kind: a.kind, granted: a.granted, version, source })));
  if (error) cLog.error(`record failed for ${userId}: ${error.message}`);
  return !error;
}

/** Every answer of a person, newest first. */
export async function consentHistory(db: SupabaseClient, userId: string): Promise<ConsentRow[]> {
  const { data } = await db
    .from("user_consents")
    .select("kind, granted, version, source, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as ConsentRow[];
}
