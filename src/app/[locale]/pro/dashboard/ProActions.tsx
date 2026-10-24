"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { FileUp, Loader2, Trash2, UserPlus } from "lucide-react";
import type { ShopRole } from "@/lib/pro/shops";

/**
 * The Pro dashboard's buttons (0173): add or remove a member, choose a plan,
 * send a document. Each calls its /api/pro route and re-reads the page.
 */
function useCall() {
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const t = useTranslations("pro.dashboard");
  const [busy, setBusy] = useState(false);
  async function call(url: string, init: RequestInit, success: string | null): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        toast(apiError(j, t("actionFailed")), "error");
        return null;
      }
      if (success) toast(success, "success");
      router.refresh();
      return j;
    } catch {
      toast(t("actionFailed"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { call, busy };
}

export function AddMember({ shopId, actor }: { shopId: string; actor: ShopRole }) {
  const t = useTranslations("pro.dashboard");
  const tRoles = useTranslations("pro.roles");
  const { call, busy } = useCall();
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<ShopRole>("agent");
  const roles: ShopRole[] = actor === "owner" ? ["agent", "admin"] : ["agent"];
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await call(`/api/pro/shops/${shopId}/members`, { method: "POST", body: JSON.stringify({ phone, role }) }, t("memberAdded"))) setPhone("");
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-[12px] font-bold text-foreground">{t("memberPhone")}</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+216 …"
          dir="ltr"
          inputMode="tel"
          className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13.5px] focus:border-gold focus:outline-none"
          required
        />
      </label>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as ShopRole)}
        className="h-10 rounded-xl border border-border bg-surface px-2 text-[13px]"
        aria-label={t("memberRole")}
      >
        {roles.map((r) => (
          <option key={r} value={r}>{tRoles(r)}</option>
        ))}
      </select>
      <button type="submit" disabled={busy} className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-1.5 px-4 text-[13px] disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} {t("addMember")}
      </button>
      <p className="w-full text-[11.5px] text-muted">{t("memberHint")}</p>
    </form>
  );
}

export function RemoveMember({ shopId, userId }: { shopId: string; userId: string }) {
  const t = useTranslations("pro.dashboard");
  const { call, busy } = useCall();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (window.confirm(t("removeConfirm"))) {
          void call(`/api/pro/shops/${shopId}/members`, { method: "DELETE", body: JSON.stringify({ userId }) }, t("memberRemoved"));
        }
      }}
      className="tap-target inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold text-muted ring-1 ring-border hover:text-[var(--danger)] disabled:opacity-60"
      aria-label={t("removeMember")}
    >
      <Trash2 className="size-3.5" /> {t("removeMember")}
    </button>
  );
}

export function ChoosePlan({ shopId, plan, label }: { shopId: string; plan: string; label: string }) {
  const router = useRouter();
  const { call, busy } = useCall();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const j = await call(`/api/pro/shops/${shopId}/subscribe`, { method: "POST", body: JSON.stringify({ plan }) }, null);
        if (j?.paymentId) router.push(`/payment/checkout?payment=${j.paymentId}` as never);
      }}
      className="mazed-btn-luxe tap-target mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 text-[13px] disabled:opacity-60"
    >
      {busy && <Loader2 className="size-4 animate-spin" />} {label}
    </button>
  );
}

const KINDS = ["rne", "patente", "identity", "other"] as const;

export function SendDocument({ shopId }: { shopId: string }) {
  const t = useTranslations("pro.dashboard");
  const tDocs = useTranslations("pro.documents");
  const { toast } = useToast();
  const { call, busy } = useCall();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("rne");
  const [sending, setSending] = useState(false);

  async function send(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast(t("fileTooBig"), "warning");
      return;
    }
    setSending(true);
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const url = await call(`/api/pro/shops/${shopId}/documents`, { method: "POST", body: JSON.stringify({ step: "url", ext }) }, null);
      if (!url?.signedUrl || !url.path) return;
      const form = new FormData();
      form.append("", file);
      const put = await fetch(String(url.signedUrl), { method: "PUT", body: form });
      if (!put.ok) {
        toast(t("actionFailed"), "error");
        return;
      }
      await call(
        `/api/pro/shops/${shopId}/documents`,
        { method: "POST", body: JSON.stringify({ step: "save", path: url.path, kind, fileName: file.name }) },
        t("documentSent"),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className="h-10 rounded-xl border border-border bg-surface px-2 text-[13px]" aria-label={t("documentKind")}>
        {KINDS.map((k) => (
          <option key={k} value={k}>{tDocs(k)}</option>
        ))}
      </select>
      <label className={`mazed-btn-luxe tap-target inline-flex h-10 cursor-pointer items-center gap-1.5 px-4 text-[13px] ${busy || sending ? "pointer-events-none opacity-60" : ""}`}>
        {sending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} {t("sendDocument")}
        <input
          type="file"
          accept=".pdf,image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
