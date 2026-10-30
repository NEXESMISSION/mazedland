import { describe, it, expect } from "vitest";
import { missingObjects, objectExists } from "./storage";

/** What storage lists under a folder: files carry an id, a sub-folder has none. */
type Entry = { name: string; id: string | null };

function fakeStorage(folders: Record<string, Entry[]>, failing = false) {
  const admin = {
    storage: {
      from: () => ({
        list: async (folder: string) =>
          failing ? { data: null, error: new Error("storage down") } : { data: folders[folder] ?? [], error: null },
      }),
    },
  };
  return admin as unknown as Parameters<typeof objectExists>[0];
}

describe("objectExists", () => {
  const admin = fakeStorage({
    "u1": [{ name: "photo.jpg", id: "obj-1" }, { name: "sub-pay", id: null }],
    "u1/sub-pay": [{ name: "inner.jpg", id: "obj-2" }],
  });

  it("finds a file by its path", async () => {
    expect(await objectExists(admin, "receipts", "u1/photo.jpg")).toBe(true);
    expect(await objectExists(admin, "receipts", "u1/sub-pay/inner.jpg")).toBe(true);
  });

  it("does not take a folder for a file", async () => {
    // The QA tour (2026-10-30): a receipt path that was only a folder holding
    // a real file passed, and the payment waited with nothing to open.
    expect(await objectExists(admin, "receipts", "u1/sub-pay")).toBe(false);
  });

  it("refuses a path that was never uploaded, or has no name", async () => {
    expect(await objectExists(admin, "receipts", "u1/ghost.jpg")).toBe(false);
    expect(await objectExists(admin, "receipts", "u1/")).toBe(false);
  });

  it("counts a storage error as present", async () => {
    expect(await objectExists(fakeStorage({}, true), "receipts", "u1/photo.jpg")).toBe(true);
  });
});

describe("missingObjects", () => {
  it("names the paths whose file is not there, in order", async () => {
    const admin = fakeStorage({ u1: [{ name: "a.jpg", id: "1" }, { name: "c.jpg", id: "3" }] });
    expect(await missingObjects(admin, "properties", ["u1/a.jpg", "u1/b.jpg", "u1/c.jpg", "u1/d.jpg"])).toEqual([
      "u1/b.jpg",
      "u1/d.jpg",
    ]);
    expect(await missingObjects(admin, "properties", [])).toEqual([]);
  });
});
