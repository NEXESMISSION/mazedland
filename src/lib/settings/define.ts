/**
 * How a setting is described, read and checked — no list of settings here
 * (that is ./registry.ts), and nothing that touches the database, so the
 * console's client forms can use the same checks as the API.
 *
 * Every setting has a default. A missing row, or a stored value that no
 * longer fits (a number out of range after the range was tightened, a text
 * where a number belongs), reads as the default: the site never breaks on a
 * bad setting, it falls back to the behaviour it shipped with.
 */

export type SettingGroup =
  | "features"
  | "home"
  | "moderation"
  | "publication"
  | "buyers"
  | "contact"
  | "social"
  | "payment"
  | "company"
  | "limits"
  | "privacy";

export type SettingUnit = "days" | "seconds" | "tnd" | "percent" | "photos" | "per_hour" | "per_day";

type Common = {
  group: SettingGroup;
  /** Never sent to a browser that is not the console (bank details). */
  secret?: boolean;
  /** Read by client components: sent to every page through the layout. */
  client?: boolean;
  /** The console page where what this setting governs is managed. */
  href?: string;
};

type Num = {
  min: number;
  max: number;
  unit?: SettingUnit;
  step?: number;
  /** The only values the console offers, as a list instead of a box to type in. 0 reads « jamais ». */
  choices?: readonly number[];
} & (
  | { optional?: false; default: number }
  /** Empty is a value of its own (no VAT line), stored as "" and read as null. */
  | { optional: true; default: number | null }
);

export type SettingDef =
  | (Common & { type: "bool"; default: boolean })
  | (Common & { type: "int" } & Num)
  | (Common & { type: "number" } & Num)
  | (Common & { type: "text"; default: string; max: number; multiline?: boolean; ltr?: boolean })
  | (Common & { type: "list"; default: readonly string[]; maxItems: number; maxLen: number; lower?: boolean });

/** What a definition reads as. */
export type ValueOf<D extends SettingDef> = D extends { type: "bool" }
  ? boolean
  : D extends { type: "int" | "number"; optional: true }
    ? number | null
    : D extends { type: "int" | "number" }
      ? number
      : D extends { type: "list" }
        ? string[]
        : string;

/** The bounds an error message quotes: a number's range, a text's length, a list's size. */
export function rangeOf(def: SettingDef): { min: number; max: number } {
  if (def.type === "int" || def.type === "number") return { min: def.min, max: def.max };
  if (def.type === "text") return { min: 0, max: def.max };
  if (def.type === "list") return { min: 0, max: def.maxItems };
  return { min: 0, max: 0 };
}

/** A stored value, or the default when it is missing or does not fit. */
export function readSetting<D extends SettingDef>(def: D, raw: unknown): ValueOf<D> {
  if (raw === undefined) return cloneDefault(def) as ValueOf<D>;
  const checked = checkSetting(def, raw);
  if (!checked.ok) return cloneDefault(def) as ValueOf<D>;
  if ((def.type === "int" || def.type === "number") && checked.value === "") return null as ValueOf<D>;
  return checked.value as ValueOf<D>;
}

function cloneDefault(def: SettingDef): unknown {
  return def.type === "list" ? [...def.default] : def.default;
}

export type SettingError = "invalid_bool" | "invalid_number" | "out_of_range" | "invalid_text" | "too_long" | "invalid_list";
export type Checked = { ok: true; value: unknown } | { ok: false; error: SettingError };

/**
 * What an admin typed, made into what is stored — or why not. Forms send
 * strings as often as numbers, so « 30 » and 30 are both a number, « true »
 * and true both a yes.
 */
export function checkSetting(def: SettingDef, raw: unknown): Checked {
  switch (def.type) {
    case "bool":
      if (raw === true || raw === "true") return { ok: true, value: true };
      if (raw === false || raw === "false") return { ok: true, value: false };
      return { ok: false, error: "invalid_bool" };
    case "int":
    case "number": {
      if (def.optional && (raw === "" || raw === null)) return { ok: true, value: "" };
      if (raw === null || raw === "" || typeof raw === "boolean" || Array.isArray(raw)) return { ok: false, error: "invalid_number" };
      const n = Number(typeof raw === "string" ? raw.trim().replace(",", ".") : raw);
      if (!Number.isFinite(n) || (def.type === "int" && !Number.isInteger(n))) return { ok: false, error: "invalid_number" };
      if (n < def.min || n > def.max) return { ok: false, error: "out_of_range" };
      if (def.choices && !def.choices.includes(n)) return { ok: false, error: "out_of_range" };
      return { ok: true, value: n };
    }
    case "text": {
      if (typeof raw !== "string") return { ok: false, error: "invalid_text" };
      const s = raw.trim();
      if (s.length > def.max) return { ok: false, error: "too_long" };
      return { ok: true, value: s };
    }
    case "list": {
      const items = typeof raw === "string" ? raw.split(/[\n,]/) : raw;
      if (!Array.isArray(items) || items.some((w) => typeof w !== "string")) return { ok: false, error: "invalid_list" };
      const clean = Array.from(
        new Set(
          (items as string[])
            .map((w) => (def.lower ? w.trim().toLowerCase() : w.trim()))
            .filter(Boolean)
            .map((w) => w.slice(0, def.maxLen)),
        ),
      );
      if (clean.length > def.maxItems) return { ok: false, error: "out_of_range" };
      return { ok: true, value: clean };
    }
  }
}
