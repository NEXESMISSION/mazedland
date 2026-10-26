import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Page tokens are sealed before they reach the database (0170
 * `social_accounts.token_sealed`), so a leaked backup or a stray `select *`
 * shows ciphertext, never a token that can post on Mazed Immo's pages.
 *
 * AES-256-GCM with a key that lives only in the environment:
 *
 *   SOCIAL_TOKEN_KEY = 32 random bytes, base64   (openssl rand -base64 32)
 *
 * Sealed form: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The tag
 * makes a tampered or truncated value fail to open instead of decrypting to
 * garbage. `v1` leaves room to rotate the key later.
 */

export class TokenKeyError extends Error {}

function keyFrom(env: Record<string, string | undefined>): Buffer {
  const raw = env.SOCIAL_TOKEN_KEY?.trim();
  if (!raw) throw new TokenKeyError("SOCIAL_TOKEN_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new TokenKeyError("SOCIAL_TOKEN_KEY must be 32 bytes, base64");
  return key;
}

export function hasTokenKey(env: Record<string, string | undefined> = process.env): boolean {
  try {
    keyFrom(env);
    return true;
  } catch {
    return false;
  }
}

export function sealToken(token: string, env: Record<string, string | undefined> = process.env): string {
  const key = keyFrom(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function openToken(sealed: string, env: Record<string, string | undefined> = process.env): string {
  const key = keyFrom(env);
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("sealed token: unknown format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
