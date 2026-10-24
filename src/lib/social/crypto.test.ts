import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { hasTokenKey, openToken, sealToken, TokenKeyError } from "./crypto";

const env = { SOCIAL_TOKEN_KEY: randomBytes(32).toString("base64") };

describe("page token sealing", () => {
  it("opens what it sealed, and never stores the token in clear", () => {
    const token = "EAAG-page-token-123";
    const sealed = sealToken(token, env);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(token);
    expect(openToken(sealed, env)).toBe(token);
  });

  it("seals the same token differently each time", () => {
    expect(sealToken("same", env)).not.toBe(sealToken("same", env));
  });

  it("refuses a tampered value", () => {
    const parts = sealToken("EAAG-page-token-123", env).split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 1;
    parts[3] = body.toString("base64url");
    expect(() => openToken(parts.join("."), env)).toThrow();
  });

  it("refuses another key", () => {
    const sealed = sealToken("EAAG", env);
    expect(() => openToken(sealed, { SOCIAL_TOKEN_KEY: randomBytes(32).toString("base64") })).toThrow();
  });

  it("says when the key is missing or the wrong size", () => {
    expect(hasTokenKey({})).toBe(false);
    expect(hasTokenKey({ SOCIAL_TOKEN_KEY: randomBytes(16).toString("base64") })).toBe(false);
    expect(hasTokenKey(env)).toBe(true);
    expect(() => sealToken("x", {})).toThrow(TokenKeyError);
  });
});
