import { describe, it, expect } from "vitest";
import { safeInternalPath } from "./safePath";

describe("safeInternalPath", () => {
  it("keeps same-site absolute paths", () => {
    expect(safeInternalPath("/account/listings")).toBe("/account/listings");
    expect(safeInternalPath("/annonces?cat=villas&min=100000")).toBe("/annonces?cat=villas&min=100000");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeInternalPath("//evil.example")).toBe("/");
    expect(safeInternalPath("/\\evil.example")).toBe("/");
    expect(safeInternalPath("/\t/evil.example")).toBe("/");
  });

  it("rejects absolute URLs and relative paths", () => {
    expect(safeInternalPath("https://evil.example")).toBe("/");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/");
    expect(safeInternalPath("account")).toBe("/");
  });

  it("falls back for missing input, with a custom fallback", () => {
    expect(safeInternalPath(undefined)).toBe("/");
    expect(safeInternalPath(null, "/account/payments")).toBe("/account/payments");
    expect(safeInternalPath("", "/x")).toBe("/x");
  });
});
