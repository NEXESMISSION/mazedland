import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

const aLog = log.scope("audit");

/**
 * The console's audit trail (0178 `admin_audit`): who changed what, with the
 * value before and after. Kept for the decisions that cost money or access —
 * settings, the team, roles, bans, credits and badges, payments, prices —
 * where `activity_log` only says that something happened.
 *
 * The table refuses UPDATE and DELETE from everyone, the server included, so
 * an entry cannot be tidied away later. Only a full admin reads it
 * (/admin/equipe?vue=journal).
 */
export type AuditEntry = {
  /** Dotted, like the activity log: `settings.update`, `team.set`, `payment.decide`… */
  action: string;
  /** `setting`, `profile`, `payment`, `product`, `credits`, `badge` */
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
};

/**
 * Records one entry with the service client. A failure is logged, not thrown:
 * the decision it describes has already been made.
 */
export async function audit(admin: SupabaseClient, actorId: string, entry: AuditEntry): Promise<void> {
  const { error } = await admin.from("admin_audit").insert({
    actor_id: actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note ?? null,
  });
  if (error) aLog.error("audit insert failed", { action: entry.action, msg: error.message });
}

/**
 * A bank detail in the trail: enough to see that it changed and to which
 * account (its last four characters), never the whole number.
 */
export function maskSecret(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value;
  const tail = value.length > 6 ? value.slice(-4) : "";
  return `••••${tail}`;
}
