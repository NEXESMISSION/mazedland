/**
 * The console's sections, and who on the team may open which.
 *
 * Every console member has `profiles.role = 'admin'`; what narrows them is
 * `profiles.admin_scopes` (0178): `null` is the whole console — the owner and
 * whoever they trust with everything — and a list is just those sections. A
 * moderator sees the annonces queue and not the payments; a finance person
 * sees the payments and not the moderation queue.
 *
 * The same names are checked three times: the rail hides what is not theirs,
 * each page and API route refuses it (requireAdmin), and the database refuses
 * it too for money, prices, the journal and the settings (admin_can() in
 * 0178), so a token used outside the console gets no further.
 */

/** One per console screen, named after its URL segment under /admin. */
export const ADMIN_SECTIONS = [
  "annonces",
  "demandes",
  "vendeurs",
  "agences",
  "social",
  "paiements",
  "offres",
  "resultats",
  "publicites",
  "home",
  "popups",
  "notifications",
  "legal-docs",
  "catalogue",
  "activity",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/**
 * Never handed out piecemeal: the settings (payee, limits, every switch) and
 * the team itself. Only a full admin opens them — otherwise someone given
 * « Finance » could give themselves the rest.
 */
export const OWNER_SECTIONS = ["settings", "equipe"] as const;
export type OwnerSection = (typeof OWNER_SECTIONS)[number];

export type ConsoleSection = AdminSection | OwnerSection;

/** `null` = the whole console. */
export type AdminScopes = readonly AdminSection[] | null;

/** Ready-made roles, so adding someone is one choice rather than fifteen boxes. */
export const ROLE_PRESETS = {
  moderation: ["annonces", "demandes", "vendeurs", "agences", "social"],
  finance: ["paiements", "offres", "resultats"],
  content: ["home", "publicites", "popups", "notifications", "legal-docs", "catalogue", "social"],
} as const satisfies Record<string, readonly AdminSection[]>;
export type RolePreset = keyof typeof ROLE_PRESETS;
export const ROLE_PRESET_KEYS = Object.keys(ROLE_PRESETS) as RolePreset[];

export function isAdminSection(v: unknown): v is AdminSection {
  return typeof v === "string" && (ADMIN_SECTIONS as readonly string[]).includes(v);
}

export function isOwnerSection(v: unknown): v is OwnerSection {
  return typeof v === "string" && (OWNER_SECTIONS as readonly string[]).includes(v);
}

/** Whether a member with these scopes may open a section. No section = any member. */
export function canOpen(scopes: AdminScopes, section?: ConsoleSection): boolean {
  if (scopes === null || section === undefined) return true;
  if (isOwnerSection(section)) return false;
  return scopes.includes(section);
}

/**
 * A scopes list as stored: known sections only, each once, in the console's
 * order. An empty list is refused (`null`): a member who may open nothing is
 * not a member — the team screen removes them instead.
 */
export function cleanScopes(input: unknown): AdminSection[] | null {
  if (!Array.isArray(input)) return null;
  const wanted = new Set(input.filter(isAdminSection));
  const out = ADMIN_SECTIONS.filter((s) => wanted.has(s));
  return out.length > 0 ? out : null;
}

/** The preset these scopes match exactly, `"full"` for the whole console, or `"custom"`. */
export function presetOf(scopes: AdminScopes): RolePreset | "full" | "custom" {
  if (scopes === null) return "full";
  const key = [...scopes].sort().join(",");
  for (const p of ROLE_PRESET_KEYS) {
    if ([...ROLE_PRESETS[p]].sort().join(",") === key) return p;
  }
  return "custom";
}

/** What `profiles.admin_scopes` holds, read defensively (a DB array of text, or null). */
export function scopesFromRow(raw: unknown): AdminScopes {
  if (raw === null || raw === undefined) return null;
  // A stored list with nothing known left in it opens nothing, not everything.
  return cleanScopes(raw) ?? [];
}
