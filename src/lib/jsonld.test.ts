import { describe, it, expect } from "vitest";
import { jsonLdSafe } from "./jsonld";

describe("jsonLdSafe", () => {
  it("neutralizes a </script> breakout in a seller-controlled string", () => {
    const out = jsonLdSafe({ name: "</script><script>alert(document.cookie)</script>" });
    // The literal closing-tag sequence must NOT survive in the emitted text.
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    // The `<` is escaped to its JSON unicode form instead.
    expect(out).toContain("\\u003c");
  });

  it("escapes every <, > and & occurrence", () => {
    const out = jsonLdSafe({ a: "<", b: ">", c: "&", url: "https://x.test/?a=1&b=2" });
    expect(out).not.toMatch(/[<>&]/);
  });

  it("round-trips: escaped output is valid JSON equal to the input", () => {
    const obj = {
      "@context": "https://schema.org",
      name: "Villa <b>A</b> & terrasse </script>",
      description: "x > y && z < w",
      offers: { price: 1000, list: ["a", "b"] },
    };
    expect(JSON.parse(jsonLdSafe(obj))).toEqual(obj);
  });
});
