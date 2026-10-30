import { describe, it, expect } from "vitest";
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
