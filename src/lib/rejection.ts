// ============================================================================
// Rejection text encoding + parsing.
//
// Admin rejection reasons are stored as plain text in
// properties.rejection_reason and payments.admin_notes — there is no
// dedicated `category` or `mode` column. We encode both pieces of
// metadata as a bracket prefix at the start of the string:
//
//     "[PHOTOS,DOCUMENTS] La fiche n'est pas exploitable..."   (focused)
//     "[PHOTOS,DOCUMENTS|ALL] La fiche n'est pas exploitable..." (full)
//
// CATEGORIES — comma-separated, one or more. A rejection can carry
// several because one listing can have several problems at once
// (blurry photos + missing title deed).
//
// MODE (optional, after the pipe) — controls what the seller's edit
// view shows. Default is "focused": only the flagged sections are
// rendered, so the seller doesn't re-walk an entire form for a single
// fix. "ALL" tells the edit view to render the whole form with the
// flagged sections ring-highlighted — useful when the admin wants the
// seller to also re-review surrounding fields (e.g. price was wrong
// AND description felt off, but only price was tagged).
//
// `parseRejection` strips the prefix and returns the structured
// payload; `encodeRejection` does the reverse. Display layers should
// always run text through `parseRejection` so the seller never sees
// the raw `[CATEGORY|MODE]` token in the UI.
// ============================================================================

export const REJECTION_CATEGORIES = [
  "photos",
  "documents",
  "address",
  "price",
  "description",
  "title",
  "general",
] as const;

export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

// Human-readable labels per category. Kept here (not in i18n messages)
// because the admin reject form, the seller dashboard, and the edit
// banner all read from the same source.
export const REJECTION_CATEGORY_LABELS: Record<RejectionCategory, string> = {
  photos: "Photos",
  documents: "Documents",
  address: "Adresse",
  price: "Prix",
  description: "Description",
  title: "Titre",
  general: "Général",
};

// Each category points the seller at the section of the edit form they
// need to revisit. Pointing to the wizard step is enough — scrolling
// to a specific field would mean wiring SellForm to expose anchors,
// not worth the surface change for the same outcome.
export const REJECTION_CATEGORY_HINTS: Record<RejectionCategory, string> = {
  photos:      "Reprenez des photos nettes et bien éclairées.",
  documents:   "Téléversez à nouveau vos documents légaux.",
  address:     "Complétez ou corrigez l'adresse de l'annonce.",
  price:       "Revoyez le prix de vente ou la mise à prix.",
  description: "Étoffez la description : superficie, état, environnement.",
  title:       "Reformulez le titre — soyez clair et descriptif.",
  general:     "Consultez le motif et corrigez l'annonce en conséquence.",
};

export type RejectionMode = "focused" | "full";

interface ParsedRejection {
  /** All categories the admin flagged. May contain a single item, or
   *  several. Empty array only for un-tagged legacy text, which we
   *  surface as a `general` rejection. */
  categories: RejectionCategory[];
  /** First category in the list — convenience for callers that only
   *  render one icon / scroll target. */
  category: RejectionCategory;
  /** The motif as written by the admin, without the [CATEGORY] prefix. */
  message: string;
  /** Human-readable joined label for the categories — "Photos · Documents". */
  label: string;
  /** Short hint pointing the seller at what to fix. Multi-category
   *  rejections get a generic "plusieurs points" message. */
  hint: string;
  /** True iff the original text had a recognizable category prefix.
   *  Legacy rejections without a prefix default to 'general'. */
  tagged: boolean;
  /** What the seller's edit view should render — see file header. */
  mode: RejectionMode;
}

function dedupeOrder<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

export function parseRejection(raw: string | null | undefined): ParsedRejection {
  const text = (raw ?? "").trim();
  const fallback: ParsedRejection = {
    categories: ["general"],
    category: "general",
    message: text,
    label: REJECTION_CATEGORY_LABELS.general,
    hint: REJECTION_CATEGORY_HINTS.general,
    tagged: false,
    // Un-tagged rejections default to full mode — there are no
    // specific sections to focus on, so hiding parts of the form
    // would leave the seller stranded.
    mode: "full",
  };
  if (!text) {
    return { ...fallback, message: "" };
  }
  // [CATEGORIES] message  or  [CATEGORIES|MODE] message
  const match = text.match(/^\[([A-Z][A-Z,\s]*)(?:\|([A-Z]+))?\]\s*(.*)$/s);
  if (!match) return fallback;

  const codes = match[1]
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is RejectionCategory =>
      (REJECTION_CATEGORIES as readonly string[]).includes(c),
    );
  const categories = dedupeOrder(codes);
  if (categories.length === 0) return fallback;

  const modeRaw = (match[2] ?? "").trim().toLowerCase();
  // "all" → render the full edit form with highlights. Anything else
  // (missing or unrecognized) → focused mode, which is the default
  // we picked because the user's UX brief was "don't make them
  // re-walk the whole form".
  const mode: RejectionMode = modeRaw === "all" ? "full" : "focused";

  const message = match[3].trim();
  const label = categories.map((c) => REJECTION_CATEGORY_LABELS[c]).join(" · ");
  const hint =
    categories.length === 1
      ? REJECTION_CATEGORY_HINTS[categories[0]]
      : "Plusieurs points à corriger — voyez les sections mises en évidence ci-dessous.";

  return {
    categories,
    category: categories[0],
    message,
    label,
    hint,
    tagged: true,
    mode,
  };
}

export function encodeRejection(
  categories: RejectionCategory | RejectionCategory[],
  message: string,
  mode: RejectionMode = "focused",
): string {
  const arr = Array.isArray(categories) ? categories : [categories];
  const cleaned = dedupeOrder(arr).filter((c) =>
    (REJECTION_CATEGORIES as readonly string[]).includes(c),
  );
  const tag = (cleaned.length > 0 ? cleaned : (["general"] as RejectionCategory[]))
    .map((c) => c.toUpperCase())
    .join(",");
  // Only emit the |MODE suffix when it differs from the default.
  // Keeps legacy rejections (no mode) re-parsing identically and the
  // common case (focused mode) compact in the DB.
  const modeSuffix = mode === "full" ? "|ALL" : "";
  return `[${tag}${modeSuffix}] ${message.trim()}`;
}
