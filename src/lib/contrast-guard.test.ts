/**
 * No dark label on a dark button, anywhere.
 *
 * Since the palette went monochrome, `--gold` is ink (#27272a), not gold —
 * but the classes still say « gold », and black text on it kept coming back:
 * « Publier » and « Accepter le reçu » in the console read as black blocks
 * (2026-10-24). This walks every component and fails on any class list that
 * puts a dark fill and a dark text colour on the same element.
 *
 * Only unprefixed classes count: `hover:bg-gold` with `text-foreground` is a
 * different state, not the same one. A light label on a dark fill is
 * `text-[var(--background)]` (white), as on `.mazed-btn-luxe`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DARK_FILL =
  /^(bg-\[var\(--(gold|gold-bright|gold-deep|foreground)\)\]|bg-gold|bg-gold-bright|bg-gold-deep|bg-foreground|bg-black|bg-(zinc|neutral|stone|gray|slate)-(800|900|950)|mazed-btn-luxe)$/;
const DARK_TEXT =
  /^(text-black|text-foreground|text-\[var\(--(foreground|gold|gold-bright|gold-deep)\)\]|text-gold|text-gold-bright|text-gold-deep|text-(zinc|neutral|stone|gray|slate)-(700|800|900|950))$/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Every quoted string on a line that holds both a dark fill and a dark text colour. */
export function darkOnDark(line: string): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
    const tokens = m[2].split(/\s+/);
    if (tokens.some((t) => DARK_FILL.test(t)) && tokens.some((t) => DARK_TEXT.test(t))) found.push(m[2].trim());
  }
  return found;
}

describe("contrast guard", () => {
  it("catches the pattern it is meant to catch", () => {
    expect(darkOnDark(`className="bg-[var(--gold)] text-black px-3"`)).toHaveLength(1);
    expect(darkOnDark(`"rounded bg-foreground text-foreground"`)).toHaveLength(1);
    expect(darkOnDark(`"bg-[var(--gold)] text-[var(--background)]"`)).toHaveLength(0);
    expect(darkOnDark(`"text-foreground hover:bg-gold"`)).toHaveLength(0);
    expect(darkOnDark(`"bg-gold-faint text-gold"`)).toHaveLength(0);
  });

  it("finds no dark label on a dark fill in the components", () => {
    const root = path.join(process.cwd(), "src");
    const hits: string[] = [];
    for (const file of sourceFiles(root)) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const cls of darkOnDark(line)) hits.push(`${path.relative(process.cwd(), file)}:${i + 1}  ${cls.slice(0, 120)}`);
        });
    }
    expect(hits, `Dark text on a dark fill — use text-[var(--background)]:\n${hits.join("\n")}`).toEqual([]);
  });
});
