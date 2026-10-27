import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { proGate } from "@/lib/pro/api";
import { can } from "@/lib/pro/shops";
import { getSettings } from "@/lib/settings/server";
import { loadShopReport } from "@/lib/pro/reportsServer";
import { parsePeriod, reportCsv } from "@/lib/pro/reports";

export const dynamic = "force-dynamic";

/**
 * GET /api/pro/shops/[id]/report?days=30&locale=fr — the « Rapports » table
 * as a spreadsheet (CSV, one line per annonce). Any member may download it;
 * an agent gets their own annonces, as on the page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settings = await getSettings();
  if (!settings.feature_pro_reports) return NextResponse.json({ error: "feature_off" }, { status: 404 });
  const gate = await proGate(req, { id, action: "publish" });
  if (gate instanceof NextResponse) return gate;

  const days = parsePeriod(req.nextUrl.searchParams.get("days"));
  const locale = req.nextUrl.searchParams.get("locale") === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale, namespace: "pro.reports" });
  const report = await loadShopReport(gate.admin, {
    shopId: id,
    days,
    sellerId: can(gate.role, "manage_listings") ? null : gate.user.id,
    tracesKeptDays: settings.privacy_traces_days,
  });
  const csv = reportCsv(report, {
    reference: t("csv.reference"),
    title: t("csv.title"),
    visitors: t("metric.visitors"),
    reveals: t("metric.reveals"),
    favourites: t("metric.favourites"),
    visits: t("metric.visits"),
    leads: t("metric.leads"),
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mazed-rapport-${report.from}-${report.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
