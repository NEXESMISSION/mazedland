import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many full admins (role admin, the whole console, not banned) there are
 * besides `exceptId`. Zero means `exceptId` is the last one: taking their
 * access away would leave nobody to manage the team or the settings.
 */
export async function otherFullAdmins(admin: SupabaseClient, exceptId: string): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .is("admin_scopes", null)
    .is("banned_at", null)
    .neq("id", exceptId);
  return count ?? 0;
}
