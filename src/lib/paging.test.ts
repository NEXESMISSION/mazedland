import { describe, expect, it } from "vitest";
import { pageNumber } from "./paging";

describe("pageNumber", () => {
  it("reads a whole page number", () => {
    expect(pageNumber("2")).toBe(2);
    expect(pageNumber("9999")).toBe(9999);
    expect(pageNumber("2.7")).toBe(2);
  });

  it("is the first page for anything that is not one", () => {
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber("")).toBe(1);
    expect(pageNumber("abc")).toBe(1);
    expect(pageNumber("0")).toBe(1);
    expect(pageNumber("-3")).toBe(1);
    expect(pageNumber("1")).toBe(1);
  });
});
