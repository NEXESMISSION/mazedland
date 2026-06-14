import { describe, it, expect, afterEach } from "vitest";
import { checkSupabaseRef, assertSupabaseRef } from "./guard";

// Audit #11 — a regression gate for the DB-identity guard (the fix for the
// "batta served the car database" incident). If the guard is ever weakened or
// the committed expected-ref is blanked, these fail in CI.

const urlFor = (ref: string) => `https://${ref}.supabase.co`;
const prev = process.env.EXPECTED_SUPABASE_REF;

afterEach(() => {
  if (prev === undefined) delete process.env.EXPECTED_SUPABASE_REF;
  else process.env.EXPECTED_SUPABASE_REF = prev;
});

describe("supabase db-identity guard", () => {
  it("passes when the URL's project ref matches the expected ref", () => {
    process.env.EXPECTED_SUPABASE_REF = "abcdef1234567890wxyz";
    expect(checkSupabaseRef(urlFor("abcdef1234567890wxyz"))).toBeNull();
    expect(() => assertSupabaseRef(urlFor("abcdef1234567890wxyz"))).not.toThrow();
  });

  it("flags + throws WRONG DATABASE when the URL points at another project", () => {
    process.env.EXPECTED_SUPABASE_REF = "abcdef1234567890wxyz";
    const problem = checkSupabaseRef(urlFor("zzzz9999zzzz9999zzzz"));
    expect(problem).toMatch(/WRONG DATABASE/);
    expect(problem).toContain("zzzz9999zzzz9999zzzz");
    expect(() => assertSupabaseRef(urlFor("zzzz9999zzzz9999zzzz"))).toThrow(/db-guard/);
  });

  it("no-ops on a missing URL (the caller handles missing env separately)", () => {
    process.env.EXPECTED_SUPABASE_REF = "abcdef1234567890wxyz";
    expect(checkSupabaseRef(undefined)).toBeNull();
    expect(checkSupabaseRef("")).toBeNull();
    expect(() => assertSupabaseRef(null)).not.toThrow();
  });

  it("honors the EXPECTED_SUPABASE_REF env override", () => {
    process.env.EXPECTED_SUPABASE_REF = "overrideref0000000000";
    expect(checkSupabaseRef(urlFor("overrideref0000000000"))).toBeNull();
    expect(checkSupabaseRef(urlFor("abcdef1234567890wxyz"))).toMatch(/WRONG DATABASE/);
  });

  it("is ACTIVE by default — the committed expected ref must be non-empty", () => {
    // No env override: the guard falls back to the committed EXPECTED_REF_DEFAULT.
    // A URL that is definitely not this app's project MUST be flagged; if it
    // isn't, the committed default was blanked and the guard is disabled.
    delete process.env.EXPECTED_SUPABASE_REF;
    expect(checkSupabaseRef(urlFor("definitelynotthisproject"))).toMatch(/WRONG DATABASE/);
  });
});
