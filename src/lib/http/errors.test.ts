import { describe, it, expect } from "vitest";
import { fail } from "./errors";

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
