import { describe, expect, it } from "vitest";
import { crc32, zipStore } from "./zip";

const enc = new TextEncoder();

describe("zipStore", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(enc.encode("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes stored entries, a central directory and its end record", () => {
    const z = zipStore([
      { name: "properties/a.webp", data: enc.encode("hello") },
      { name: "receipts/وصل.txt", data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50); // first local header
    expect(v.getUint16(8, true)).toBe(0); // stored, not deflated
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2); // two entries
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(v.getUint16(cdOffset + 8, true) & 0x0800).toBe(0x0800); // UTF-8 names
  });
});
