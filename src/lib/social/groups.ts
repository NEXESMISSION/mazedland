import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

/**
 * A Facebook group as the console's form sends it, checked. Pure, so the
 * create and edit routes share it and it is tested without a database.
 */
export type GroupInput = {
  name: string;
  url: string;
  governorates: string[];
  deal_types: ("sale" | "rent")[];
  category_kinds: ("residential" | "land" | "commercial")[];
  members: number | null;
  allows_links: boolean;
  rules: string | null;
};

const KINDS = ["residential", "land", "commercial"] as const;

/** https://www.facebook.com/groups/<id or name>, without tracking or trailing parts. */
export function normalizeGroupUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^(www\.|m\.|web\.)?facebook\.com$/i.test(u.hostname)) return null;
  const m = /^\/groups\/([^/?#]+)/.exec(u.pathname);
  if (!m) return null;
  return `https://www.facebook.com/groups/${m[1]}`;
}

export function parseGroupInput(raw: Record<string, unknown>): { ok: true; value: GroupInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 120) return { ok: false, error: "name" };
  const url = typeof raw.url === "string" ? normalizeGroupUrl(raw.url) : null;
  if (!url) return { ok: false, error: "url" };

  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const governorates = list(raw.governorates).filter((g) => (TUNISIAN_GOVERNORATES as readonly string[]).includes(g));
  const deal_types = list(raw.deal_types).filter((d): d is "sale" | "rent" => d === "sale" || d === "rent");
  if (deal_types.length === 0) return { ok: false, error: "deal_types" };
  const category_kinds = list(raw.category_kinds).filter((k): k is GroupInput["category_kinds"][number] =>
    (KINDS as readonly string[]).includes(k),
  );

  const membersNum = Number(raw.members);
  const members = raw.members === null || raw.members === undefined || raw.members === "" || !Number.isFinite(membersNum) || membersNum < 0
    ? null
    : Math.round(membersNum);
  const rules = typeof raw.rules === "string" && raw.rules.trim() ? raw.rules.trim().slice(0, 1000) : null;

  return {
    ok: true,
    value: {
      name,
      url,
      governorates: [...new Set(governorates)],
      deal_types: [...new Set(deal_types)],
      category_kinds: [...new Set(category_kinds)],
      members,
      allows_links: raw.allows_links !== false,
      rules,
    },
  };
}
