import { createHash } from "crypto";

/**
 * OTP code hashing shared by the phone send + verify routes. Codes are stored
 * hashed in phone_otps — the plaintext never touches the DB. The pepper is a
 * server-only secret (SMS_OTP_PEPPER, falling back to the service-role key,
 * which is always present server-side), so a DB leak alone can't reverse codes.
 */
function pepper(): string {
  return process.env.SMS_OTP_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function hashCode(phone: string, code: string): string {
  return createHash("sha256").update(`${code}:${phone}:${pepper()}`).digest("hex");
}
