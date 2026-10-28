import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("share, install and backup buttons", () => {
  it("can each be switched off from the console", () => {
    expect(SETTINGS.feature_install_button).toMatchObject({ type: "bool", default: true, client: true });
    expect(SETTINGS.feature_share).toMatchObject({ type: "bool", default: true, client: true });
  });

  it("offers to install the site from both headers, and the console from its own", () => {
    for (const f of ["src/components/layout/TopBar.tsx", "src/components/layout/DesktopNav.tsx"]) {
      expect(read(f), f).toContain('<InstallButton scope="site"');
    }
    expect(read("src/components/admin/InstallAppButton.tsx")).toContain('scope="admin"');
  });

  it("keeps the install button when the browser has no prompt: the steps by hand instead", () => {
    const src = read("src/components/layout/InstallButton.tsx");
    expect(src).toContain('return ios ? "ios" : "manual"');
    expect(src).toContain('t("manualHint")');
  });

  it("puts « Partager » at the top of the annonce page, with the words that travel with the link", () => {
    const page = read("src/app/[locale]/annonces/[id]/page.tsx");
    // Once, under the title — it used to sit in both contact cards, further
    // down than anyone looked (the owner, 2026-10-28).
    expect((page.match(/<ShareButton\b/g) ?? []).length).toBe(1);
    expect(page).toContain("<ShareButton title={l.title} text={shareWords} />");
  });

  it("lets a seller share what is online from « Mes annonces » and the agence's dashboard", () => {
    // A regex: the files are read as they are on disk, CRLF or LF.
    expect(read("src/app/[locale]/account/listings/page.tsx")).toMatch(/l\.status === "published" && \(\s*<ShareButton\s+variant="text"/);
    expect(read("src/app/[locale]/pro/dashboard/page.tsx")).toMatch(/l\.status === "published" && <ShareButton variant="text"/);
  });

  it("lets only a full admin download a backup, and records it", () => {
    const route = read("src/app/api/admin/backup/route.ts");
    expect(route).toContain('requireAdmin(req, "settings")');
    expect(route).toContain('action: "admin.backup"');
    const sql = read("supabase/migrations/0189_admin_backup.sql");
    expect(sql).toContain("revoke execute on function public.admin_backup_table(text) from public, anon, authenticated");
    expect(sql).toContain("values ('backups', 'backups', false)");
    expect(read("src/app/[locale]/admin/settings/page.tsx")).toContain("actions={<BackupButton />}");
  });
});
