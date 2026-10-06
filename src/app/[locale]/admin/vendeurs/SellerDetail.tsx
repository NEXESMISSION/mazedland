"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  StatusPill, Confirm, SelectField, NumberField, TextareaField,
  FieldGrid, useAdminAction, EYEBROW,
} from "@/components/admin/kit";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import {
  BadgeCheck, ShieldOff, Ticket, ChevronLeft, ExternalLink, Ban, RotateCcw,
} from "lucide-react";

/**
 * The right pane: one account, and the four levers an admin has over it —
 * role, badge, credits, ban.
 *
 * `/admin/users` and `/admin/sellers` used to be separate screens, so
 * answering "why can this agency publish for free?" meant opening both and
 * matching names by eye. They are one pane now, because they are one question.
 */

export type SellerDetailData = {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  governorate: string | null;
  createdAt: string;
  bannedAt: string | null;
  bannedReason: string | null;
  listings: { published: number; total: number };
  credits: { remaining: number; total: number; expiresAt: string | null };
  badge: { expiresAt: string | null } | null;
  payments: { captured: number; amount: number };
  /** `label` is already in the page's language (productName). */
  packs: { id: string; label: string; quota: number | null }[];
};

const dt = (iso: string | null, locale: string) => (iso ? formatDate(iso, locale, "medium") : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-[5px]">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}

export function SellerDetail({
  seller,
  backHref,
}: {
  seller: SellerDetailData;
  backHref: string;
}) {
  const { run, pending } = useAdminAction();
  const t = useTranslations("adminSellers.detail");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [confirm, setConfirm] = useState<null | "ban" | "revoke">(null);
  const [panel, setPanel] = useState<null | "credits" | "badge">(null);

  const [role, setRole] = useState(seller.role);
  const [packId, setPackId] = useState(seller.packs[0]?.id ?? "");
  const [quota, setQuota] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(12);
  const [note, setNote] = useState("");

  const s = seller;
  const badgeLive = Boolean(s.badge?.expiresAt && new Date(s.badge.expiresAt) > new Date());

  const act = (body: Record<string, unknown>, success: string) =>
    run({ url: `/api/admin/vendeurs/${s.id}`, method: "POST", body, success });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <Link
          href={backHref as "/admin/vendeurs"}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
          {t("back")}
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
            {s.name}
          </h1>
          {s.bannedAt && <StatusPill tone="bad">{t("banned")}</StatusPill>}
          {badgeLive && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--gold)]">
              <BadgeCheck className="size-3.5" strokeWidth={2.4} /> {t("verified")}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
          <StatusPill status={s.role} />
          {s.phone && (
            <span>
              <Ltr>{s.phone}</Ltr>
            </span>
          )}
          {s.governorate && <span>{governorateLabel(s.governorate, locale)}</span>}
          <span>{t("registeredOn", { date: dt(s.createdAt, locale) })}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {s.bannedAt && (
          <p className="border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]">
            <span className="font-semibold">{t("bannedOn", { date: dt(s.bannedAt, locale) })}</span>{" "}
            {s.bannedReason ?? t("noReason")}
          </p>
        )}

        <section className="mt-2 border-t border-border pt-4">
          <h2 className={EYEBROW}>{t("activity")}</h2>
          <dl className="mt-2">
            <Row label={t("listings")}>
              <Link
                href={`/admin/annonces?status=all&q=${encodeURIComponent(s.phone ?? "")}` as "/admin/annonces"}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--gold)] hover:underline"
              >
                {t("listingsValue", { published: s.listings.published, total: s.listings.total })}
                <ExternalLink className="size-3" strokeWidth={2.2} />
              </Link>
            </Row>
            <Row label={t("payments")}>
              {t("paymentsValue", { count: s.payments.captured })} ·{" "}
              <span className="mazed-tabular">
                {s.payments.amount.toFixed(2)} {tCommon("tnd")}
              </span>
            </Row>
            <Row label={t("remaining")}>
              {s.credits.total > 0 ? (
                <>
                  <span className="mazed-tabular">
                    <Ltr>
                      {s.credits.remaining} / {s.credits.total}
                    </Ltr>
                  </span>
                  {s.credits.expiresAt && (
                    <span className="text-subtle">
                      {" · "}
                      {t("expiresOn", { date: dt(s.credits.expiresAt, locale) })}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-subtle">{t("noPack")}</span>
              )}
            </Row>
            <Row label={t("badge")}>
              {badgeLive
                ? t("badgeActiveUntil", { date: dt(s.badge!.expiresAt, locale) })
                : t("none")}
            </Row>
          </dl>
        </section>

        <section className="mt-5 border-t border-border pt-4">
          <h2 className={EYEBROW}>{t("role")}</h2>
          <div className="mt-3 flex items-end gap-2">
            <div className="w-56">
              <SelectField
                label={t("accountType")}
                value={role}
                onChange={setRole}
                options={[
                  { value: "individual", label: tAdmin("status.individual") },
                  { value: "agency", label: tAdmin("status.agency") },
                  { value: "admin", label: tAdmin("status.admin") },
                ]}
              />
            </div>
            <AdminButton
              size="md"
              pending={pending}
              disabled={role === s.role}
              disabledReason={t("roleUnchanged")}
              onClick={() => act({ action: "set_role", role }, t("roleChanged"))}
            >
              {t("apply")}
            </AdminButton>
          </div>
        </section>

        {panel === "credits" && (
          <section className="mt-5 border-s-2 border-[var(--gold)] ps-4">
            <h2 className={`${EYEBROW} text-[var(--gold)]`}>{t("grantCreditsTitle")}</h2>
            <p className="mt-1.5 text-[11.5px] text-subtle">{t("grantCreditsBody")}</p>
            <div className="mt-3 space-y-3.5">
              <SelectField
                label={t("pack")}
                value={packId}
                onChange={setPackId}
                options={
                  s.packs.length > 0
                    ? s.packs.map((p) => ({
                        value: p.id,
                        label: p.quota ? t("packWithQuota", { label: p.label, quota: p.quota }) : p.label,
                      }))
                    : [{ value: "", label: t("noPacks") }]
                }
                hint={
                  s.packs.length === 0
                    ? t("noPacksHint")
                    : undefined
                }
              />
              <FieldGrid>
                <NumberField
                  label={t("publications")}
                  value={quota}
                  onChange={setQuota}
                  min={1}
                  hint={t("publicationsHint")}
                />
                <NumberField
                  label={t("validity")}
                  value={months}
                  onChange={setMonths}
                  min={1}
                  suffix={t("months")}
                />
              </FieldGrid>
              <TextareaField label={t("internalNote")} value={note} onChange={setNote} rows={2} />
              <div className="flex justify-end gap-2">
                <AdminButton variant="quiet" onClick={() => setPanel(null)}>
                  {t("cancel")}
                </AdminButton>
                <AdminButton
                  variant="primary"
                  pending={pending}
                  disabled={!packId}
                  disabledReason={t("choosePack")}
                  onClick={async () => {
                    const ok = await act(
                      { action: "grant_credits", product_id: packId, quota, months, note },
                      t("credited"),
                    );
                    if (ok) setPanel(null);
                  }}
                >
                  {t("credit")}
                </AdminButton>
              </div>
            </div>
          </section>
        )}

        {panel === "badge" && (
          <section className="mt-5 border-s-2 border-[var(--gold)] ps-4">
            <h2 className={`${EYEBROW} text-[var(--gold)]`}>{t("grantBadgeTitle")}</h2>
            <p className="mt-1.5 text-[11.5px] text-subtle">{t("grantBadgeBody")}</p>
            <div className="mt-3 space-y-3.5">
              <NumberField
                label={t("validity")}
                value={months}
                onChange={setMonths}
                min={1}
                suffix={t("months")}
                hint={t("validityHint")}
              />
              <TextareaField label={t("internalNote")} value={note} onChange={setNote} rows={2} />
              <div className="flex justify-end gap-2">
                <AdminButton variant="quiet" onClick={() => setPanel(null)}>
                  {t("cancel")}
                </AdminButton>
                <AdminButton
                  variant="primary"
                  pending={pending}
                  onClick={async () => {
                    const ok = await act({ action: "grant_badge", months, note }, t("badgeGranted"));
                    if (ok) setPanel(null);
                  }}
                >
                  {t("grant")}
                </AdminButton>
              </div>
            </div>
          </section>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        <AdminButton
          icon={<Ticket className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setPanel(panel === "credits" ? null : "credits")}
        >
          {t("credit")}
        </AdminButton>
        {badgeLive ? (
          <AdminButton
            variant="danger"
            icon={<ShieldOff className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("revoke")}
          >
            {t("revokeBadge")}
          </AdminButton>
        ) : (
          <AdminButton
            icon={<BadgeCheck className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setPanel(panel === "badge" ? null : "badge")}
          >
            {t("grantBadge")}
          </AdminButton>
        )}

        {s.bannedAt ? (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            pending={pending}
            icon={<RotateCcw className="size-3.5" strokeWidth={2.4} />}
            onClick={() => act({ action: "unban" }, t("reactivated"))}
          >
            {t("reactivate")}
          </AdminButton>
        ) : (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            icon={<Ban className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("ban")}
          >
            {t("suspend")}
          </AdminButton>
        )}
      </footer>

      <Confirm
        open={confirm === "ban"}
        title={t("banTitle")}
        body={t("banBody")}
        confirmLabel={t("suspend")}
        pending={pending}
        reason={{ label: t("reasonInternal"), placeholder: t("banPlaceholder"), required: true }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "ban", reason }, t("suspended"))) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "revoke"}
        title={t("revokeTitle")}
        body={t("revokeBody")}
        confirmLabel={t("revokeConfirm")}
        pending={pending}
        reason={{ label: t("reasonInternal"), placeholder: t("revokePlaceholder"), required: true }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "revoke_badge", reason }, t("badgeRevoked"))) setConfirm(null);
        }}
      />
    </div>
  );
}
