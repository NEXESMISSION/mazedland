import { describe, expect, it } from "vitest";
import { settleUpload, trackUpload, uploadsInFlight } from "./uploadsInFlight";

/** A form's setter, recording every count it hears. */
function form() {
  const heard: number[] = [];
  const set = (n: number) => { heard.push(n); };
  return { set, heard };
}

describe("uploads in flight", () => {
  it("counts photos until each settles, whoever started them", () => {
    const f = form();
    // The photo step's uploader starts three…
    for (const id of ["a", "b", "c"]) trackUpload(f.set, id);
    // …the seller moves on (that uploader is gone), and a second uploader on
    // the same form starts one more.
    trackUpload(f.set, "d");
    expect(f.heard).toEqual([1, 2, 3, 4]);
    // The first three land after their uploader was unmounted.
    for (const id of ["a", "b", "c"]) settleUpload(f.set, id);
    expect(uploadsInFlight(f.set)).toBe(1);
    settleUpload(f.set, "d");
    expect(f.heard.at(-1)).toBe(0);
    expect(uploadsInFlight(f.set)).toBe(0);
  });

  it("keeps each form's count apart", () => {
    const one = form();
    const two = form();
    trackUpload(one.set, "x");
    trackUpload(two.set, "x");
    settleUpload(one.set, "x");
    expect(uploadsInFlight(one.set)).toBe(0);
    expect(uploadsInFlight(two.set)).toBe(1);
  });

  it("ignores a photo counted twice, one never counted, and no listener", () => {
    const f = form();
    trackUpload(f.set, "a");
    trackUpload(f.set, "a");
    settleUpload(f.set, "zzz");
    settleUpload(f.set, "a");
    settleUpload(f.set, "a");
    trackUpload(undefined, "a");
    settleUpload(undefined, "a");
    expect(f.heard).toEqual([1, 0]);
  });
});
