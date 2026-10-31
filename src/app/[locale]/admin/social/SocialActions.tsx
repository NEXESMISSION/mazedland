"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Link2, Play, RotateCcw } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";
import { Confirm } from "@/components/admin/kit";
import { useAdminAction } from "@/components/admin/kit/useAdminAction";
import { useToast } from "@/components/ui/Toast";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";

/**
 * The Social Publisher console's buttons (0170): review a request, edit a
 * post's text, move a job along, keep the groups directory. Every call goes
 * through useAdminAction, so errors read the same as everywhere else in the
 * console and the page re-reads the database after each one.
 */

/** Approve now or at a set time, or refuse with a reason the seller will read. */
export function ReviewActions({ requestId }: { requestId: string }) {
  const t = useTranslations("adminSocial");
  const { run, pending } = useAdminAction();
  const [when, setWhen] = useState("");
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {t("scheduleAt")}
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="h-7 rounded border border-border bg-surface px-2 text-[12px] text-foreground"
        />
      </label>
      <AdminButton
        variant="primary"
        pending={pending}
        onClick={() =>
          run({
            url: `/api/admin/social/requests/${requestId}`,
            method: "POST",
            body: { action: "approve", scheduledFor: when ? new Date(when).toISOString() : null },
            success: t(when ? "approvedLater" : "approved"),
          })
        }
      >
        {t(when ? "approveLater" : "approve")}
      </AdminButton>
      <AdminButton variant="danger" onClick={() => setRejecting(true)}>
        {t("reject")}
      </AdminButton>
      <Confirm
        open={rejecting}
        title={t("rejectTitle")}
        body={t("rejectBody")}
        confirmLabel={t("reject")}
        pending={pending}
        reason={{ label: t("rejectReason"), placeholder: t("rejectPlaceholder"), required: true }}
        onCancel={() => setRejecting(false)}
        onConfirm={async (reason) => {
          const ok = await run({
            url: `/api/admin/social/requests/${requestId}`,
            method: "POST",
            body: { action: "reject", reason },
            success: t("rejected"),
          });
          if (ok) setRejecting(false);
        }}
      />
    </div>
  );
}

/** The post's text, editable while the request waits for review. */
export function VariantEditor({ variantId, body, edited }: { variantId: string; body: string; edited: boolean }) {
  const t = useTranslations("adminSocial");
  const { run, pending, done } = useAdminAction();
  const [text, setText] = useState(body);

  return (
    <div>
      <textarea
        aria-label={t("postText")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(6, text.split("\n").length + 1))}
        dir="auto"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground focus:border-[var(--gold)] focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          {text.length} / 2200{edited ? ` · ${t("edited")}` : ""}
        </span>
        <AdminButton
          pending={pending}
          done={done}
          disabled={text === body}
          onClick={() => run({ url: `/api/admin/social/variants/${variantId}`, method: "PATCH", body: { body: text }, success: t("saved") })}
        >
          {t("save")}
        </AdminButton>
      </div>
    </div>
  );
}

/**
 * A job in the queue. The page and Instagram can be run now or retried; a
 * group, or anything the API cannot do, is done by a person: copy the text,
 * open the group, post, then paste the post's link here.
 */
export function JobActions({
  jobId,
  canRun,
  manual,
  copyText,
  groupUrl,
  link = null,
}: {
  jobId: string;
  canRun: boolean;
  manual: boolean;
  copyText: string | null;
  groupUrl: string | null;
  /** The annonce's Mazed Immo link, for a post made by hand (Instagram's bio or sticker, the page's text). */
  link?: string | null;
}) {
  const t = useTranslations("adminSocial");
  const { run, pending } = useAdminAction();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const call = (action: string, extra: Record<string, unknown> = {}, success?: string) =>
    run({ url: `/api/admin/social/jobs/${jobId}`, method: "POST", body: { action, ...extra }, success });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {canRun && (
          <AdminButton variant="primary" pending={pending} icon={<Play className="size-3.5" />} onClick={() => call("run", {}, t("ran"))}>
            {t("runNow")}
          </AdminButton>
        )}
        {copyText && (
          <AdminButton
            icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            onClick={async () => {
              await navigator.clipboard.writeText(copyText).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? t("copied") : t("copy")}
          </AdminButton>
        )}
        {groupUrl && (
          <a href={groupUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded border border-border px-2.5 text-[12px] font-semibold text-foreground hover:border-[var(--gold-soft)]">
            <ExternalLink className="size-3.5" /> {t("openGroup")}
          </a>
        )}
        {link && (
          <AdminButton
            icon={linkCopied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
            onClick={async () => {
              await navigator.clipboard.writeText(link).catch(() => {});
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 1600);
            }}
          >
            {linkCopied ? t("linkCopied") : t("copyLink")}
          </AdminButton>
        )}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded border border-border px-2.5 text-[12px] font-semibold text-foreground hover:border-[var(--gold-soft)]">
            <ExternalLink className="size-3.5" /> {t("openListing")}
          </a>
        )}
        {!manual && !canRun && (
          <AdminButton icon={<RotateCcw className="size-3.5" />} pending={pending} onClick={() => call("retry", {}, t("requeued"))}>
            {t("retry")}
          </AdminButton>
        )}
        <AdminButton variant="quiet" pending={pending} onClick={() => call("cancel", {}, t("cancelled"))}>
          {t("cancelJob")}
        </AdminButton>
      </div>
      {manual && link && (
        <p className="truncate font-mono text-[11px] text-muted" dir="ltr" title={link}>
          {link}
        </p>
      )}
      {manual && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="url"
            aria-label={t("postUrlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("postUrlPlaceholder")}
            dir="ltr"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-[12px] text-foreground"
          />
          <AdminButton
            pending={pending}
            onClick={async () => {
              if (await call("done", { url }, t("markedDone"))) setUrl("");
            }}
          >
            {t("markDone")}
          </AdminButton>
        </div>
      )}
    </div>
  );
}

/** Read-only check that the stored token still works; says what it found. */
export function AccountTest({ accountId }: { accountId: string }) {
  const t = useTranslations("adminSocial");
  const { toast } = useToast();
  const { run, pending } = useAdminAction();
  return (
    <AdminButton
      pending={pending}
      onClick={() =>
        run({
          url: `/api/admin/social/accounts/${accountId}/test`,
          method: "POST",
          success: null,
          onSuccess: (data) => {
            const d = data as {
              name?: string;
              quota?: { used: number; total: number } | null;
              instagram?: { username: string | null; added: boolean } | null;
            };
            if (d.instagram?.added) {
              // The page's Instagram account was just adopted: the list of
              // accounts and the queue are stale, so the page reloads.
              toast(t("testOkInstagram", { name: d.name ?? "", username: d.instagram.username ?? "" }), "success");
              setTimeout(() => window.location.reload(), 1800);
              return;
            }
            toast(d.quota ? t("testOkQuota", { name: d.name ?? "", used: d.quota.used, total: d.quota.total }) : t("testOk", { name: d.name ?? "" }), "success");
          },
        })
      }
    >
      {t("test")}
    </AdminButton>
  );
}

/** Disconnect a page: its token is erased. */
export function AccountActions({ accountId }: { accountId: string }) {
  const t = useTranslations("adminSocial");
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdminButton variant="danger" onClick={() => setOpen(true)}>
        {t("disconnect")}
      </AdminButton>
      <Confirm
        open={open}
        title={t("disconnectTitle")}
        body={t("disconnectBody")}
        confirmLabel={t("disconnect")}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          if (await run({ url: `/api/admin/social/accounts/${accountId}`, method: "DELETE", success: t("disconnected") })) setOpen(false);
        }}
      />
    </>
  );
}

/** Add a Facebook group to the directory. */
export function GroupForm() {
  const t = useTranslations("adminSocial");
  const locale = useLocale();
  const { run, pending } = useAdminAction();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [governorates, setGovernorates] = useState<string[]>([]);
  const [deals, setDeals] = useState<string[]>(["sale", "rent"]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [members, setMembers] = useState("");
  const [allowsLinks, setAllowsLinks] = useState(true);
  const [rules, setRules] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean) =>
    `rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 transition ${on ? "bg-[var(--gold-faint)] text-[var(--gold)] ring-[var(--gold-soft)]" : "text-muted ring-border hover:text-foreground"}`;
  const field = "h-8 w-full rounded border border-border bg-surface px-2.5 text-[12.5px] text-foreground";

  return (
    <form
      className="space-y-3 rounded-2xl bg-surface p-4 ring-1 ring-border"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run({
          url: "/api/admin/social/groups",
          method: "POST",
          body: { name, url, governorates, deal_types: deals, category_kinds: kinds, members: members || null, allows_links: allowsLinks, rules },
          success: t("groupAdded"),
        });
        if (!ok) return;
        setName("");
        setUrl("");
        setGovernorates([]);
        setKinds([]);
        setMembers("");
        setRules("");
      }}
    >
      <p className="text-[13px] font-bold text-foreground">{t("addGroup")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label={t("groupName")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groupName")} className={field} required />
        <input aria-label={t("groupUrl")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/groups/…" dir="ltr" className={field} required />
      </div>
      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-muted">{t("groupDeals")}</p>
        <div className="flex flex-wrap gap-1.5">
          {["sale", "rent"].map((d) => (
            <button key={d} type="button" className={chip(deals.includes(d))} onClick={() => toggle(deals, setDeals, d)}>
              {t(`deal.${d}`)}
            </button>
          ))}
          {["residential", "land", "commercial"].map((k) => (
            <button key={k} type="button" className={chip(kinds.includes(k))} onClick={() => toggle(kinds, setKinds, k)}>
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">{t("groupKindsHint")}</p>
      </div>
      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-muted">{t("groupGovernorates")}</p>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {TUNISIAN_GOVERNORATES.map((g) => (
            <button key={g} type="button" className={chip(governorates.includes(g))} onClick={() => toggle(governorates, setGovernorates, g)}>
              {governorateLabel(g, locale)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">{t("groupGovernoratesHint")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <input aria-label={t("groupMembers")} value={members} onChange={(e) => setMembers(e.target.value)} placeholder={t("groupMembers")} inputMode="numeric" className={field} />
        <input aria-label={t("groupRules")} value={rules} onChange={(e) => setRules(e.target.value)} placeholder={t("groupRules")} className={field} />
      </div>
      <label className="flex items-center gap-2 text-[12px] text-foreground">
        <input type="checkbox" checked={allowsLinks} onChange={(e) => setAllowsLinks(e.target.checked)} />
        {t("groupAllowsLinks")}
      </label>
      <div className="flex items-center gap-2">
        <AdminButton type="submit" variant="primary" pending={pending} disabled={deals.length === 0}>
          {t("addGroup")}
        </AdminButton>
      </div>
    </form>
  );
}

/** Pause, resume or delete a group of the directory. */
export function GroupActions({ groupId, status }: { groupId: string; status: string }) {
  const t = useTranslations("adminSocial");
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <AdminButton
        pending={pending}
        onClick={() =>
          run({
            url: `/api/admin/social/groups/${groupId}`,
            body: { status: status === "active" ? "paused" : "active" },
            success: null,
          })
        }
      >
        {t(status === "active" ? "pause" : "resume")}
      </AdminButton>
      <AdminButton variant="quiet" onClick={() => setOpen(true)}>
        {t("delete")}
      </AdminButton>
      <Confirm
        open={open}
        title={t("deleteGroupTitle")}
        body={t("deleteGroupBody")}
        confirmLabel={t("delete")}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          if (await run({ url: `/api/admin/social/groups/${groupId}`, method: "DELETE", success: t("groupDeleted") })) setOpen(false);
        }}
      />
    </div>
  );
}
