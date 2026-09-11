import { describe, it, expect } from "vitest";
import { hasSupabaseSessionCookie, isSupabaseAuthCookie } from "./session-cookie";

describe("isSupabaseAuthCookie", () => {
  it("matches the session cookie, whole or chunked", () => {
    expect(isSupabaseAuthCookie("sb-abcd1234-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd1234-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd1234-auth-token.1")).toBe(true);
  });

  it("ignores every other cookie", () => {
    expect(isSupabaseAuthCookie("NEXT_LOCALE")).toBe(false);
    expect(isSupabaseAuthCookie("auth-token")).toBe(false);
    expect(isSupabaseAuthCookie("sb-abcd1234-refresh")).toBe(false);
    expect(isSupabaseAuthCookie("")).toBe(false);
  });
});

describe("hasSupabaseSessionCookie", () => {
  it("finds a session cookie among others", () => {
    expect(
      hasSupabaseSessionCookie("NEXT_LOCALE=fr; sb-abcd-auth-token.0=base64-eyJ; theme=light"),
    ).toBe(true);
  });

  it("is false for a guest", () => {
    expect(hasSupabaseSessionCookie("NEXT_LOCALE=fr; theme=light")).toBe(false);
    expect(hasSupabaseSessionCookie("")).toBe(false);
  });

  it("reads names, not values", () => {
    expect(hasSupabaseSessionCookie("note=sb-abcd-auth-token")).toBe(false);
  });
});
