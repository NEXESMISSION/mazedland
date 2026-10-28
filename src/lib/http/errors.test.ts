import { describe, it, expect } from "vitest";
import { describeError, fail } from "./errors";

// What the server log says about an error: a PostgREST error is a plain
// object, and `String(err)` printed « [object Object] » for every 500.
describe("describeError()", () => {
  it("an Error: its message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("a PostgREST error object: message, code, details and hint in one line", () => {
    expect(describeError({ message: 'invalid input value for enum listing_status: "ready"', code: "22P02", details: null, hint: null }))
      .toBe('invalid input value for enum listing_status: "ready" · code=22P02');
    expect(describeError({ message: "duplicate key", code: "23505", details: "Key (id)=(1) already exists.", hint: "" }))
      .toBe("duplicate key · code=23505 · details=Key (id)=(1) already exists.");
  });

  it("any other object: its JSON; a primitive: as text", () => {
    expect(describeError({ status: 500 })).toBe('{"status":500}');
    expect(describeError("raw")).toBe("raw");
    expect(describeError(42)).toBe("42");
  });
});

// The redaction boundary is load-bearing for security AND observability: the
// client must get a STABLE code + a correlation id, and the raw Postgres/
// PostgREST message (table/column/constraint names, sometimes data) must NEVER
// cross to the caller. These pin both halves.
describe("fail() redactor", () => {
  it("returns the stable code + an 8-char requestId, and never the raw error", async () => {
    const res = fail(
      "payout_failed",
      500,
      new Error('relation "secret_internal_table" does not exist'),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("payout_failed");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId).toHaveLength(8);
    // The raw DB text must not leak through the response body.
    expect(JSON.stringify(body)).not.toContain("secret_internal_table");
  });

  it("emits a requestId even with no error arg, and honors a passed-in id", async () => {
    const res = fail("invalid_amount", 400, undefined, "abcd1234");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_amount", requestId: "abcd1234" });
  });

  it("coerces a non-Error thrown value without leaking it", async () => {
    const res = fail("bid_failed", 409, "raw string with schema_name leak");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("bid_failed");
    expect(JSON.stringify(body)).not.toContain("schema_name");
  });
});
