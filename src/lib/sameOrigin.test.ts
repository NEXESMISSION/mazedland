import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { isSameOrigin } from "./sameOrigin";

// isSameOrigin only touches req.headers.get(...), so a minimal Headers-backed
// stub is a faithful stand-in for a NextRequest here.
function reqWith(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("isSameOrigin", () => {
  it("accepts a matching Origin", () => {
    expect(isSameOrigin(reqWith({ host: "batta.tn", origin: "https://batta.tn" }))).toBe(true);
  });
  it("rejects a cross-site Origin", () => {
    expect(isSameOrigin(reqWith({ host: "batta.tn", origin: "https://evil.example" }))).toBe(false);
  });
  it("falls back to Referer host when Origin is absent", () => {
    expect(isSameOrigin(reqWith({ host: "batta.tn", referer: "https://batta.tn/auctions/1" }))).toBe(true);
    expect(isSameOrigin(reqWith({ host: "batta.tn", referer: "https://evil.example/x" }))).toBe(false);
  });
  it("blocks when there is no host", () => {
    expect(isSameOrigin(reqWith({ origin: "https://batta.tn" }))).toBe(false);
  });
  it("blocks when neither Origin nor Referer is present (curl/CLI)", () => {
    expect(isSameOrigin(reqWith({ host: "batta.tn" }))).toBe(false);
  });
  it("blocks on a malformed Origin", () => {
    expect(isSameOrigin(reqWith({ host: "batta.tn", origin: "::::not a url" }))).toBe(false);
  });
});
