/**
 * Every action the site logs has a label, in French and in Arabic.
 *
 * The console's « Derniers gestes » and the journal print an unlabelled code
 * raw — `admin.shop.suspend` in the middle of an Arabic screen (2026-10-26).
 * This reads every `logAction(…, "code")` with a fixed code and fails on one
 * that `adminActions` does not name in both languages.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { actionKey } from "./actions";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const codes = new Set<string>();
for (const file of sources(path.join(process.cwd(), "src"))) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/logAction\([^,]+,[^,]+,\s*(["`])([^"`]+)\1/g)) {
    if (!m[2].includes("${")) codes.add(m[2]);
  }
}

describe("logged actions", () => {
  it("are found", () => {
    expect(codes.size).toBeGreaterThan(40);
  });

  it("each have a French and an Arabic label", () => {
    const frLabels = (fr as { adminActions: Record<string, string> }).adminActions;
    const arLabels = (ar as { adminActions: Record<string, string> }).adminActions;
    const missing = [...codes].filter((c) => !frLabels[actionKey(c)] || !arLabels[actionKey(c)]);
    expect(missing).toEqual([]);
  });
});
