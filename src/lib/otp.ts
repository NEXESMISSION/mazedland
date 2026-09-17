import { createHash, createHmac, timingSafeEqual } from "crypto";

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

/** How long a phone-verification proof lasts — the window signup and password
 *  reset already allow between verifying a number and using it. */
export const PHONE_PROOF_TTL_MS = 15 * 60 * 1000;

/** Set on the response to /api/auth/phone/verify, read by signup and reset. */
export const PHONE_PROOF_COOKIE = "mz_phone_proof";

/**
 * A verification proof bound to the browser that passed the code.
 *
 * `phone_otps.verified_at` says "somebody proved this number in the last 15
 * minutes", not "the person asking now did", and /api/auth/reset-password
 * needed nothing else: a phone number and a new password. Sellers publish
 * their number on every annonce, so anyone could set a new password for an
 * account during the window a signup or a forgotten-password run opens — and
 * /api/auth/phone/send did not clear the flag either.
 *
 * The proof is an HMAC over the number and an expiry, returned as an HttpOnly
 * cookie. It never leaves the browser that verified, and it cannot be forged
 * without the server pepper.
 */
export function signPhoneProof(phone: string, expiresAtMs: number): string {
  const payload = `${phone}.${expiresAtMs}`;
  return `${payload}.${createHmac("sha256", pepper()).update(payload).digest("base64url")}`;
}

/** True when `proof` is this server's, for this number, and still in date. */
export function verifyPhoneProof(
  proof: string | undefined | null,
  phone: string,
  nowMs: number = Date.now(),
): boolean {
  if (!proof) return false;
  const cut = proof.lastIndexOf(".");
  if (cut <= 0) return false;
  const payload = proof.slice(0, cut);
  const [proofPhone, expRaw] = payload.split(".");
  const expiresAt = Number(expRaw);
  if (proofPhone !== phone || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  const expected = Buffer.from(createHmac("sha256", pepper()).update(payload).digest("base64url"));
  const given = Buffer.from(proof.slice(cut + 1));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
