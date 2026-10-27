"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AdminButton, adminBtn } from "@/components/admin/AdminButton";
import { Confirm, useAdminAction } from "@/components/admin/kit";
import { useToast } from "@/components/ui/Toast";
import { formatNumber } from "@/lib/utils";
import { ctr, formatCtr } from "@/lib/ads/ads";
import { Copy, Download, Pause, PencilLine, Play, Trash2 } from "lucide-react";

/**
 * What can be done to an open campaign: change it, pause or resume it,
 * delete it (asked first), and hand its report to the advertiser — as text
 * to paste into an e-mail or a WhatsApp message, or as a CSV for whoever
 * keeps a spreadsheet.
 */

export type AdReportData = {
  advertiser: string;
  placement: string;
  dates: string;
  views: number;
  clicks: number;
  /** The last 30 days, oldest first, each with its day already in words. */
  days: { day: string; label: string; views: number; clicks: number }[];
};

export function AdActions({
  id,
  active,
  ended,
  editHref,
  afterDeleteHref,
  report,
}: {
  id: string;
  active: boolean;
  /** Past its last day: resuming it would change nothing, so it is not offered. */
  ended: boolean;
  editHref: string;
  /** With the locale prefix: it goes to next/navigation's router as is. */
  afterDeleteHref: string;
  report: AdReportData;
}) {
  const t = useTranslations("adminAds.detail");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { run, pending } = useAdminAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const num = (n: number) => formatNumber(n, locale);
  const views30 = report.days.reduce((s, d) => s + d.views, 0);
  const clicks30 = report.days.reduce((s, d) => s + d.clicks, 0);

  function reportText(): string {
    const lines = [
      t("report.title", { advertiser: report.advertiser }),
      t("report.placement", { placement: report.placement }),
      t("report.period", { dates: report.dates }),
      t("report.total", {
        views: num(report.views),
        clicks: num(report.clicks),
        ctr: formatCtr(ctr(report.clicks, report.views), locale),
      }),
      t("report.last30", { views: num(views30), clicks: num(clicks30), ctr: formatCtr(ctr(clicks30, views30), locale) }),
      "",
      // Newest first, and only the days something happened: a column of
      // « 0 vue » is what an advertiser scrolls past.
      ...[...report.days]
        .reverse()
        .filter((d) => d.views > 0 || d.clicks > 0)
        .map((d) => t("report.day", { day: d.label, views: num(d.views), clicks: num(d.clicks) })),
    ];
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText());
      toast(t("copied"), "success");
    } catch {
      toast(t("copyFailed"), "error");
    }
  }

  function downloadCsv() {
    const rows = [
      [t("table.day"), t("table.views"), t("table.clicks")],
      ...report.days.map((d) => [d.day, String(d.views), String(d.clicks)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    // The BOM is for Excel, which otherwise reads the accents as Latin-1.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = report.advertiser
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    a.download = `mazed-publicite-${slug || id.slice(0, 8)}-${report.days[report.days.length - 1]?.day ?? "rapport"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
      <Link href={editHref as "/admin/publicites"} className={adminBtn("primary", "sm")}>
        <PencilLine className="size-3.5" strokeWidth={2.4} />
        {t("edit")}
      </Link>
      {!ended && (
        <AdminButton
          pending={pending}
          icon={active ? <Pause className="size-3.5" strokeWidth={2.4} /> : <Play className="size-3.5" strokeWidth={2.4} />}
          onClick={() =>
            run({
              url: `/api/admin/ads/${id}`,
              method: "PATCH",
              body: { active: !active },
              success: active ? t("paused") : t("resumed"),
            })
          }
        >
          {active ? t("pause") : t("resume")}
        </AdminButton>
      )}
      <AdminButton icon={<Copy className="size-3.5" strokeWidth={2.4} />} onClick={copy}>
        {t("copy")}
      </AdminButton>
      <AdminButton variant="quiet" icon={<Download className="size-3.5" strokeWidth={2.4} />} onClick={downloadCsv}>
        {t("csv")}
      </AdminButton>
      <AdminButton
        variant="danger"
        className="ms-auto"
        icon={<Trash2 className="size-3.5" strokeWidth={2.4} />}
        onClick={() => setConfirmDelete(true)}
      >
        {t("delete")}
      </AdminButton>

      <Confirm
        open={confirmDelete}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const ok = await run({ url: `/api/admin/ads/${id}`, method: "DELETE", success: t("deleted") });
          if (ok) {
            setConfirmDelete(false);
            router.push(afterDeleteHref);
          }
        }}
      />
    </footer>
  );
}
