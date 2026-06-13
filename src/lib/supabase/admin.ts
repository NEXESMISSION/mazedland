import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSupabaseRef } from "./guard";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS — only use in trusted
 * server-side code (route handlers, cron jobs, admin actions). Returns
 * `null` if env isn't configured so dev environments can run without
 * the service key (the call sites must handle that case explicitly).
 */
export function getServiceSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  assertSupabaseRef(url); // refuse to act against a sibling app's DB
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
