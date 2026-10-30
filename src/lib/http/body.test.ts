import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jsonObject } from "./body";

const post = (body: string | null, type = "application/json") =>
  new Request("http://localhost/api/x", { method: "POST", body, headers: type ? { "content-type": type } : {} });

// A body that is JSON but not an object used to reach `body.field` as is and
// throw — `null` made every money route answer 500.
describe("jsonObject()", () => {
  it("returns the object sent", async () => {
    expect(await jsonObject(post('{"product":"promo-accueil"}'))).toEqual({ product: "promo-accueil" });
  });

  it("reads null, a number, a string and an array as an empty object", async () => {
    expect(await jsonObject(post("null"))).toEqual({});
    expect(await jsonObject(post("42"))).toEqual({});
    expect(await jsonObject(post('"promo"'))).toEqual({});
    expect(await jsonObject(post('[{"product":"x"}]'))).toEqual({});
  });

  it("reads a body that is not JSON, or no body, as an empty object", async () => {
    expect(await jsonObject(post("{not json"))).toEqual({});
    expect(await jsonObject(post(null, ""))).toEqual({});
  });
});

const API = path.join(process.cwd(), "src", "app", "api");

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routes(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("the API routes", () => {
  // The inline fallback only covered a body that is not JSON: 26 routes
  // outside the money ones — anonymous beacons among them — answered a bare
  // 500 to the literal `null` (the QA tour, 2026-10-30). /api/ai is being
  // moved over apart; drop the exception once it is.
  it("read a JSON body through jsonObject, never the inline fallback", () => {
    const inline = routes(API)
      .filter((f) => !f.includes(`${path.sep}ai${path.sep}`))
      .filter((f) => fs.readFileSync(f, "utf8").includes(".json().catch(() => ({"));
    expect(inline.map((f) => path.relative(API, f))).toEqual([]);
  });
});
