import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isInternalLink, KIND_FALLBACK, NOTIFICATION_KINDS, resolveNotificationLink } from "./target";

const ROOT = process.cwd();

function files(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, keep));
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

/**
 * Every kind a producer writes: `p_kind: "x"` in the TypeScript routes and
 * libs (plus the `kind: "x"` of a notice object a route passes on as
 * `p_kind: notice.kind`), and the kind argument of enqueue_notification() /
 * _notify_admins() in the SQL. Migrations before 0150 defined the auction
 * product's functions, dropped with it in 0153; the functions that still run
 * were all (re)defined since.
 */
function producedKinds(): Map<string, string> {
  const where = new Map<string, string>();
  const note = (kind: string, file: string) => {
    if (!where.has(kind)) where.set(kind, file.slice(ROOT.length + 1));
  };
  for (const file of files(join(ROOT, "src"), (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
    const src = readFileSync(file, "utf8");
    if (!/enqueue_notification|_notify_admins/.test(src)) continue;
    for (const m of src.matchAll(/p_kind:\s*"([a-z_]+)"/g)) note(m[1], file);
    if (/p_kind:\s*[A-Za-z_]+\.kind\b/.test(src)) {
      for (const m of src.matchAll(/\bkind:\s*"([a-z_]+)"/g)) note(m[1], file);
    }
  }
  for (const file of files(join(ROOT, "supabase/migrations"), (n) => /^0(1[5-9]\d|[2-9]\d\d)_.*\.sql$/.test(n))) {
    const sql = readFileSync(file, "utf8");
    const call = /(?:enqueue_notification|_notify_admins)\s*\(\s*(?:[^'(),]*(?:\([^()]*\))?[^'(),]*,\s*)?'([a-z_]+)'/g;
    for (const m of sql.matchAll(call)) note(m[1], file);
    for (const m of sql.matchAll(/p_kind\s*(?::=|=>)\s*'([a-z_]+)'/g)) note(m[1], file);
  }
  return where;
}

describe("the notification kind registry", () => {
  const registered = new Set<string>(NOTIFICATION_KINDS);

  it("knows every kind the code produces", () => {
    // Nine produced kinds had drifted out of the registry (the QA tour,
    // 2026-10-30): the compile-time guardrail only covers what is listed.
    const produced = producedKinds();
    expect(produced.size).toBeGreaterThan(20);
    const missing = [...produced].filter(([kind]) => !registered.has(kind)).map(([kind, file]) => `${kind} (${file})`);
    expect(missing).toEqual([]);
  });

  it("falls back to pages that exist, never to a redirect of the retired product", () => {
    const hubs = new Set<string>(Object.values(KIND_FALLBACK).flatMap((h) => (h ? [h] : [])));
    const dead = [...hubs].filter((hub) => {
      const path = hub.split(/[?#]/)[0];
      return !existsSync(join(ROOT, "src/app/[locale]", path, "page.tsx"));
    });
    expect(dead).toEqual([]);
  });

  it("sends a seller's annonce kinds to « Mes annonces », the admin queues to the console page", () => {
    for (const kind of ["listing_submitted", "listing_published", "listing_rejected", "listing_expiring", "listing_expired"]) {
      expect(resolveNotificationLink(kind, null)).toBe("/account/listings");
    }
    expect(resolveNotificationLink("admin_receipt_pending", null)).toBe("/admin/paiements");
    expect(resolveNotificationLink("admin_listing_reported", null)).toBe("/admin/annonces");
    expect(resolveNotificationLink("admin_sms_deadletter", null)).toBe("/admin");
  });

  it("repairs the links of the retired pages", () => {
    expect(resolveNotificationLink("listing_published", "/sell/abc")).toBe("/account/listings");
    expect(resolveNotificationLink("payout_paid", "/account/payouts")).toBe("/account/payments");
    expect(resolveNotificationLink("kyc_verified", "/kyc/status")).toBe("/account");
    expect(resolveNotificationLink("listing_published", "/annonces/abc")).toBe("/annonces/abc");
  });
});

describe("isInternalLink", () => {
  it("accepts a path of the site and nothing that leaves it", () => {
    expect(isInternalLink("/annonces")).toBe(true);
    expect(isInternalLink("/account/visites?v=1#x")).toBe(true);
    expect(isInternalLink("//evil.example/x")).toBe(false);
    expect(isInternalLink("/\\evil.example/x")).toBe(false);
    expect(isInternalLink("https://evil.example/x")).toBe(false);
    expect(isInternalLink("annonces")).toBe(false);
    expect(isInternalLink("")).toBe(false);
  });

  it("is what the bell follows: a protocol-relative link falls back to the hub", () => {
    expect(resolveNotificationLink("announcement", "//evil.example/x")).toBeNull();
    expect(resolveNotificationLink("listing_published", "//evil.example/x")).toBe("/account/listings");
    expect(resolveNotificationLink("announcement", "/offres")).toBe("/offres");
  });
});
