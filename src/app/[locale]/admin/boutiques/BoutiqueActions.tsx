"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Check, X } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm } from "@/components/admin/kit";
import { useAdminAction } from "@/components/admin/kit/useAdminAction";

/** Open, refuse, suspend, reopen, verify — each one call to /api/admin/boutiques/:id. */
export function BoutiqueActions({ shopId, status, verified }: { shopId: string; status: string; verified: boolean }) {
  const t = useTranslations("adminShops");
  const { run, pending } = useAdminAction();
  const [ask, setAsk] = useState<null | "reject" | "suspend">(null);
  const act = (action: string, success: string, reason?: string) =>
    run({ url: `/api/admin/boutiques/${shopId}`, method: "POST", body: { action, reason }, success });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(status === "pending" || status === "rejected") && (
        <AdminButton variant="primary" pending={pending} icon={<Check className="size-3.5" />} onClick={() => act("approve", t("approved"))}>
          {t("approve")}
        </AdminButton>
      )}
      {status === "pending" && (
        <AdminButton variant="danger" icon={<X className="size-3.5" />} onClick={() => setAsk("reject")}>
          {t("reject")}
        </AdminButton>
      )}
      {status === "approved" && (
        <AdminButton variant="danger" onClick={() => setAsk("suspend")}>
          {t("suspend")}
        </AdminButton>
      )}
      {status === "suspended" && (
        <AdminButton pending={pending} onClick={() => act("reinstate", t("reinstated"))}>
          {t("reinstate")}
        </AdminButton>
      )}
      <AdminButton
        pending={pending}
        icon={<BadgeCheck className="size-3.5" />}
        onClick={() => act(verified ? "unverify" : "verify", t(verified ? "unverified" : "verifiedDone"))}
      >
        {t(verified ? "unverify" : "verify")}
      </AdminButton>
      <Confirm
        open={ask !== null}
        title={t(ask === "suspend" ? "suspendTitle" : "rejectTitle")}
        body={t("reasonBody")}
        confirmLabel={t(ask === "suspend" ? "suspend" : "reject")}
        pending={pending}
        reason={{ label: t("reason"), required: true }}
        onCancel={() => setAsk(null)}
        onConfirm={async (reason) => {
          if (await act(ask ?? "reject", t(ask === "suspend" ? "suspended" : "rejected"), reason)) setAsk(null);
        }}
      />
    </div>
  );
}
