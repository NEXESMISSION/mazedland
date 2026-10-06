"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/utils";
import { Ltr } from "@/components/ui/Ltr";
import {
  Send,
  Inbox,
  Trash2,
  RefreshCw,
  Search,
  X,
  CheckSquare,
  Square,
  User,
  ShieldCheck,
  Radio,
  AlertTriangle,
} from "lucide-react";
import {
  KIND_CONFIG,
  KIND_BY_VALUE,
  CORE_FIELD_KEYS,
  type FieldDef,
} from "@/lib/notifications/kinds";

type ProfileRef = { full_name: string | null; role: string | null } | null;

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  created_by: string | null;
  broadcast_id: string | null;
  // Joined via the list API — see /api/admin/notifications/list.
  recipient: ProfileRef;
  sender: ProfileRef;
};

type ListResponse = {
  items: NotificationRow[];
  total: number;
  stats: { last24h: number; last7d: number; unread: number };
};

const ROLES = ["individual", "agency", "bank", "bailiff", "inspector", "admin"] as const;

export function AdminNotificationsClient() {
  const t = useTranslations("adminNotifications");
  const [tab, setTab] = useState<"compose" | "queue">("compose");

  return (
    <div>
      <div className="flex gap-1.5 rounded-full bg-surface p-1 ring-1 ring-border w-fit">
        <TabButton active={tab === "compose"} onClick={() => setTab("compose")}>
          <Send className="size-3.5" strokeWidth={2} />
          {t("tabs.compose")}
        </TabButton>
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          <Inbox className="size-3.5" strokeWidth={2} />
          {t("tabs.queue")}
        </TabButton>
      </div>

      <div className="mt-5">
        {tab === "compose" ? <ComposeTab /> : <QueueTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
        active
          ? "bg-foreground text-background"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────────

function ComposeTab() {
  const t = useTranslations("adminNotifications");
  const [kind, setKind] = useState<string>(KIND_CONFIG[0].value);
  // Flat field bag keyed by FieldDef.key. Strings for text/url/datetime,
  // numbers for number, booleans for checkbox. Cleared (not preserved)
  // when kind changes so values don't leak across kinds with
  // overlapping keys (e.g. body, title).
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [audienceType, setAudienceType] = useState<"all" | "role" | "users">("all");
  const [role, setRole] = useState<(typeof ROLES)[number]>("individual");
  const [userIds, setUserIds] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; count: number; broadcast_id: string; test: boolean }
    | { ok: false; error: string }
    | null
  >(null);

  const config = KIND_BY_VALUE.get(kind) ?? KIND_CONFIG[0];

  function switchKind(next: string) {
    setKind(next);
    setValues({});
    setResult(null);
  }

  function setField(key: string, value: string | number | boolean) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Title is always required; the kind config can also mark other
  // fields required (e.g. maintenance.scheduled_at, system_alert.severity).
  const missingRequired = config.fields.some((f) => {
    if (!f.required) return false;
    const v = values[f.key];
    if (f.type === "checkbox") return false; // checkbox-required is rare; skip
    return v === undefined || v === null || String(v).trim() === "";
  });
  const canSend = !sending && !missingRequired;

  function buildPayloadAndCore() {
    const core: { title: string; body: string; link: string } = { title: "", body: "", link: "" };
    const payload: Record<string, unknown> = {};
    for (const f of config.fields) {
      const v = values[f.key];
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
      if (CORE_FIELD_KEYS.has(f.key)) {
        (core as Record<string, string>)[f.key] = typeof v === "string" ? v.trim() : String(v);
      } else if (f.type === "number") {
        const n = Number(v);
        if (Number.isFinite(n)) payload[f.key] = n;
      } else if (f.type === "checkbox") {
        payload[f.key] = !!v;
      } else if (f.type === "datetime" && typeof v === "string") {
        // datetime-local → ISO. Browser values look like "2026-05-19T14:30".
        const iso = new Date(v).toISOString();
        if (!Number.isNaN(new Date(iso).getTime())) payload[f.key] = iso;
      } else {
        payload[f.key] = typeof v === "string" ? v.trim() : v;
      }
    }
    return { core, payload };
  }

  async function send(test: boolean) {
    if (!canSend) return;
    setSending(true);
    setResult(null);

    const ids = userIds
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const audience =
      audienceType === "all"
        ? { type: "all" }
        : audienceType === "role"
          ? { type: "role", role }
          : { type: "users", ids };

    const { core, payload } = buildPayloadAndCore();

    try {
      const res = await fetch("/api/admin/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: core.title,
          body: core.body,
          link: core.link,
          payload,
          audience,
          test,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data?.error ?? `http_${res.status}` });
      } else {
        setResult({
          ok: true,
          count: Number(data.count ?? 0),
          broadcast_id: String(data.broadcast_id ?? ""),
          test,
        });
        if (!test) {
          setValues({});
          setUserIds("");
        }
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "network" });
    } finally {
      setSending(false);
    }
  }

  const titleValue = String(values.title ?? "");
  const bodyValue = String(values.body ?? "");
  const linkValue = String(values.link ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label={t("compose.type")}>
          <div className="flex flex-wrap gap-1.5">
            {KIND_CONFIG.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => switchKind(k.value)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ring-1 transition ${
                  kind === k.value
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-surface text-muted ring-border hover:text-foreground"
                }`}
              >
                {t(`kinds.${k.value}.label`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {t(`kinds.${config.value}.description`)}
          </p>
        </Field>

        {config.fields.map((f) => (
          <DynamicField
            key={f.key}
            kind={config.value}
            field={f}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </div>

      <div className="space-y-4">
        <Field label={t("compose.recipients")}>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "role", "users"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudienceType(a)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ring-1 transition ${
                  audienceType === a
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-surface text-muted ring-border hover:text-foreground"
                }`}
              >
                {t(`compose.audience.${a}`)}
              </button>
            ))}
          </div>

          {audienceType === "role" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ring-1 transition ${
                    role === r
                      ? "bg-gold/15 text-gold-bright ring-gold/40"
                      : "bg-surface text-muted ring-border hover:text-foreground"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}

          {audienceType === "users" && (
            <textarea
              value={userIds}
              onChange={(e) => setUserIds(e.target.value)}
              rows={5}
              dir="ltr"
              className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px]"
              placeholder={t("compose.userIdsPlaceholder")}
            />
          )}
        </Field>

        <Field label={t("compose.preview")}>
          <PreviewCard kind={kind} title={titleValue} body={bodyValue} link={linkValue} />
          {/* Show the non-core payload fields underneath the preview so
              the admin can see what extras the recipient row will carry.
              Useful before clicking "Diffuser". */}
          <PayloadSummary
            fields={config.fields.filter((f) => !CORE_FIELD_KEYS.has(f.key))}
            values={values}
          />
        </Field>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => send(true)}
            disabled={!canSend}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground transition hover:border-gold/40 disabled:opacity-50"
          >
            {t("compose.sendTest")}
          </button>
          <button
            type="button"
            onClick={() => send(false)}
            disabled={!canSend}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-background transition hover:bg-gold-bright disabled:opacity-50"
          >
            <Send className="size-3.5" strokeWidth={2.4} />
            {sending ? t("compose.sending") : t("compose.broadcast")}
          </button>
          {missingRequired && (
            <p className="text-center text-[10px] uppercase tracking-[0.12em] text-muted">
              {t("compose.missingRequired")}
            </p>
          )}
        </div>

        {result && (
          <div
            className={`rounded-lg p-3 text-[12px] ${
              result.ok
                ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                : "bg-red-50 text-red-900 ring-1 ring-red-200"
            }`}
          >
            {result.ok ? (
              <>
                <span className="font-bold">
                  {result.test ? t("compose.testSent") : t("compose.broadcastSent")}
                </span>{" "}
                {t("compose.recipientCount", { count: result.count })}
                {!result.test && (
                  <>
                    {" "}
                    · <span className="font-mono text-[10px]">{result.broadcast_id.slice(0, 8)}</span>
                  </>
                )}
              </>
            ) : (
              <>{t("compose.error", { error: result.error })}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders one field from a KindDef. The Dynamic prefix is intentional —
 * the renderer is data-driven off FieldDef.type so adding a new type
 * means extending the switch here in one place.
 */
function DynamicField({
  kind,
  field,
  value,
  onChange,
}: {
  kind: string;
  field: FieldDef;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const t = useTranslations("adminNotifications");
  const str = value === undefined || value === null ? "" : String(value);
  // Texts for this field: adminNotifications.kinds.<kind>.fields.<key>.*
  const base = `kinds.${kind}.fields.${field.key}`;
  const placeholder = field.placeholder ? t(`${base}.placeholder`) : undefined;

  return (
    <Field label={t(`${base}.label`)} required={field.required}>
      {(() => {
        switch (field.type) {
          case "text":
          case "url":
            return (
              <>
                <input
                  type={field.type === "url" ? "text" : "text"}
                  value={str}
                  onChange={(e) => onChange(e.target.value)}
                  maxLength={field.maxLength}
                  placeholder={placeholder}
                  dir={field.type === "url" ? "ltr" : undefined}
                  className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] ${
                    field.type === "url" ? "font-mono text-[12px]" : ""
                  }`}
                />
                {field.maxLength && (
                  <div className="mt-1 text-end text-[10px] uppercase tracking-[0.12em] text-muted">
                    {str.length} / {field.maxLength}
                  </div>
                )}
              </>
            );
          case "textarea":
            return (
              <>
                <textarea
                  value={str}
                  onChange={(e) => onChange(e.target.value)}
                  maxLength={field.maxLength}
                  rows={4}
                  placeholder={placeholder}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px]"
                />
                {field.maxLength && (
                  <div className="mt-1 text-end text-[10px] uppercase tracking-[0.12em] text-muted">
                    {str.length} / {field.maxLength}
                  </div>
                )}
              </>
            );
          case "number":
            return (
              <input
                type="number"
                value={str}
                onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px]"
              />
            );
          case "datetime":
            return (
              <input
                type="datetime-local"
                value={str}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px]"
              />
            );
          case "select":
            return (
              <select
                value={str}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px]"
              >
                <option value="">—</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`${base}.options.${opt}`)}
                  </option>
                ))}
              </select>
            );
          case "checkbox":
            return (
              <label className="inline-flex items-center gap-2 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => onChange(e.target.checked)}
                  className="size-4 accent-gold-bright"
                />
                <span>{t("compose.yes")}</span>
              </label>
            );
          default:
            return null;
        }
      })()}
      {field.helper && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">
          {t(`${base}.helper`)}
        </p>
      )}
    </Field>
  );
}

/**
 * Read-only "what we're sending" strip — lists each non-core field
 * value as a key:value pair so the admin sees the actual payload that
 * will hit the database before they hit Diffuser. Empty values are
 * skipped so it doesn't look noisy when most fields are blank.
 */
function PayloadSummary({
  fields,
  values,
}: {
  fields: FieldDef[];
  values: Record<string, string | number | boolean>;
}) {
  const t = useTranslations("adminNotifications");
  const present = fields.filter((f) => {
    const v = values[f.key];
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  });
  if (present.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-border bg-foreground/[0.02] p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        {t("compose.payload")}
      </div>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground">
        {present.map((f) => (
          <li key={f.key} className="flex gap-2">
            <span className="text-muted">{f.key}:</span>
            <span className="truncate">{String(values[f.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      {children}
    </div>
  );
}

function PreviewCard({
  kind,
  title,
  body,
  link,
}: {
  kind: string;
  title: string;
  body: string;
  link: string;
}) {
  const t = useTranslations("adminNotifications");
  return (
    <div className="rounded-2xl bg-surface p-3 ring-1 ring-border">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-bright">
          <Send className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-foreground leading-tight">
            {title || t("compose.previewTitle")}
          </div>
          {body && (
            <div className="mt-1 text-[12px] text-muted leading-relaxed">
              {body}
            </div>
          )}
          {link && (
            <div className="mt-1.5 truncate font-mono text-[10px] text-gold-bright">
              <span className="inline-block rtl:-scale-x-100">→</span> <Ltr>{link}</Ltr>
            </div>
          )}
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
            {kind}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Queue inspector ────────────────────────────────────────────────────────

function QueueTab() {
  const t = useTranslations("adminNotifications.queue");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ListResponse["stats"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    kind: "",
    user_id: "",
    broadcast: "",
    q: "",
    unread: false,
  });
  // Per-row selection for bulk delete. Set rather than array so toggle
  // is O(1) for large pages.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Two-step inline confirms — `selection` for "delete selected",
  // `filtered` for the larger "delete all matching the current
  // filters" action.
  const [confirmingSelection, setConfirmingSelection] = useState(false);
  const [confirmingFiltered, setConfirmingFiltered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const hasActiveFilters = !!(
    filters.kind || filters.user_id || filters.broadcast || filters.q || filters.unread
  );

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.kind) sp.set("kind", filters.kind);
    if (filters.user_id) sp.set("user_id", filters.user_id);
    if (filters.broadcast) sp.set("broadcast", filters.broadcast);
    if (filters.q) sp.set("q", filters.q);
    if (filters.unread) sp.set("unread", "1");
    sp.set("limit", String(limit));
    sp.set("offset", String(page * limit));
    return sp.toString();
  }, [filters, page]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notifications/list?${queryString}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(t("loadFailed"));
        return;
      }
      const data = (await res.json()) as ListResponse;
      setItems(data.items);
      setTotal(data.total);
      setStats(data.stats);
      // Drop any selection ids that aren't on this page anymore — keeps
      // the "X sélectionnées" count honest across pagination + filter
      // changes.
      const visibleIds = new Set(data.items.map((i) => i.id));
      setSelected((prev) => new Set([...prev].filter((id) => visibleIds.has(id))));
    } finally {
      setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronising with an external system, which is what an effect is for.
    void refresh();
  }, [refresh]);

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  async function deleteOne(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(t("deleteFailed"));
        return;
      }
      setItems((arr) => arr.filter((x) => x.id !== id));
      setTotal((n) => Math.max(0, n - 1));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setConfirmingSelection(false);
    const ids = [...selected];
    try {
      const res = await fetch("/api/admin/notifications/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t("deleteFailed"));
        return;
      }
      const { deletedCount } = payload as { deletedCount?: number };
      setSelected(new Set());
      await refresh();
      setError(
        typeof deletedCount === "number" ? t("deleted", { count: deletedCount }) : null,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteFiltered() {
    if (!hasActiveFilters) return;
    setBusy(true);
    setError(null);
    setConfirmingFiltered(false);
    try {
      const res = await fetch("/api/admin/notifications/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t("deleteFailed"));
        return;
      }
      const { deletedCount } = payload as { deletedCount?: number };
      setSelected(new Set());
      await refresh();
      setError(
        typeof deletedCount === "number" ? t("deleted", { count: deletedCount }) : null,
      );
    } finally {
      setBusy(false);
    }
  }

  function applyBroadcastFilter(broadcastId: string) {
    setFilters((f) => ({ ...f, broadcast: broadcastId }));
    setPage(0);
  }

  function applyUserFilter(userId: string) {
    setFilters((f) => ({ ...f, user_id: userId }));
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const allOnPageSelected = items.length > 0 && selected.size === items.length;

  return (
    <div>
      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label={t("last24h")} value={stats?.last24h ?? 0} />
        <StatCard label={t("last7d")} value={stats?.last7d ?? 0} />
        <StatCard label={t("unread")} value={stats?.unread ?? 0} accent />
      </div>

      {/* Filter bar. kind / user_id / broadcast_id are column names typed as
          identifiers, so they stay as-is and left-to-right in both languages. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => {
              setFilters((f) => ({ ...f, q: e.target.value }));
              setPage(0);
            }}
            placeholder={t("searchPlaceholder")}
            className="rounded-full border border-border bg-surface py-1.5 ps-7 pe-3 text-[12px]"
          />
        </div>
        <input
          type="text"
          value={filters.kind}
          onChange={(e) => {
            setFilters((f) => ({ ...f, kind: e.target.value }));
            setPage(0);
          }}
          placeholder="kind"
          dir="ltr"
          className="w-32 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[11px]"
        />
        <input
          type="text"
          value={filters.user_id}
          onChange={(e) => {
            setFilters((f) => ({ ...f, user_id: e.target.value }));
            setPage(0);
          }}
          placeholder="user_id"
          dir="ltr"
          className="w-44 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[11px]"
        />
        <input
          type="text"
          value={filters.broadcast}
          onChange={(e) => {
            setFilters((f) => ({ ...f, broadcast: e.target.value }));
            setPage(0);
          }}
          placeholder="broadcast_id"
          dir="ltr"
          className="w-44 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({ ...f, unread: !f.unread }));
            setPage(0);
          }}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ring-1 transition ${
            filters.unread
              ? "bg-foreground text-background ring-foreground"
              : "bg-surface text-muted ring-border hover:text-foreground"
          }`}
        >
          {t("unread")}
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setFilters({ kind: "", user_id: "", broadcast: "", q: "", unread: false });
              setPage(0);
            }}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:text-foreground"
          >
            <X className="size-3" strokeWidth={2.4} />
            {t("reset")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:border-gold/40 hover:text-foreground"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} strokeWidth={2.4} />
          {t("refresh")}
        </button>
      </div>

      {/* Action strip — selection-aware. When rows are selected, shows
          bulk-delete on those. Otherwise, when filters are active,
          shows the bigger "delete everything matching" action so an
          admin can clear out an entire kind / broadcast / unread pile
          without clicking through each page. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-border">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:bg-foreground/5 disabled:opacity-40"
          >
            {allOnPageSelected ? (
              <CheckSquare className="size-3.5" strokeWidth={2.2} />
            ) : (
              <Square className="size-3.5" strokeWidth={2.2} />
            )}
            {allOnPageSelected ? t("deselectAll") : t("selectAll")}
          </button>
          {selected.size > 0 && (
            <span className="font-bold text-foreground">
              {t("selectedCount", { count: selected.size })}
            </span>
          )}
          <span className="ms-2">
            {hasActiveFilters
              ? t("resultsFiltered", { count: total })
              : t("results", { count: total })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && !confirmingSelection && (
            <button
              type="button"
              onClick={() => setConfirmingSelection(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 className="size-3.5" strokeWidth={2.4} />
              {t("deleteSelection")}
            </button>
          )}
          {hasActiveFilters && selected.size === 0 && !confirmingFiltered && (
            <button
              type="button"
              onClick={() => setConfirmingFiltered(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-red-700 transition hover:bg-red-100 disabled:opacity-60"
            >
              <AlertTriangle className="size-3.5" strokeWidth={2.4} />
              {t("deleteFiltered")}
            </button>
          )}
        </div>
      </div>

      {/* Inline confirms — replace native confirm() so the dialog stays
          inside the styled admin shell. */}
      {confirmingSelection && (
        <ConfirmStrip
          message={t("confirmDeleteSelection", { count: selected.size })}
          onCancel={() => setConfirmingSelection(false)}
          onConfirm={() => void deleteSelected()}
          busy={busy}
        />
      )}
      {confirmingFiltered && (
        <ConfirmStrip
          message={t("confirmDeleteFiltered", { count: total })}
          onCancel={() => setConfirmingFiltered(false)}
          onConfirm={() => void deleteFiltered()}
          busy={busy}
        />
      )}

      {error && (
        <div className="mb-3 rounded-xl bg-foreground/5 px-3 py-2 text-[12px] text-foreground ring-1 ring-border">
          {error}
        </div>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        <ul className="divide-y divide-border">
          {items.map((n) => (
            <QueueRow
              key={n.id}
              item={n}
              selected={selected.has(n.id)}
              onToggle={() => toggleSelection(n.id)}
              onDelete={() => void deleteOne(n.id)}
              onFilterByBroadcast={() => n.broadcast_id && applyBroadcastFilter(n.broadcast_id)}
              onFilterByUser={() => applyUserFilter(n.user_id)}
              busy={busy}
            />
          ))}
          {!loading && items.length === 0 && (
            <li className="p-8 text-center text-[13px] text-muted">
              {t("empty")}
            </li>
          )}
        </ul>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted">
          <span>
            {t("pagination", { page: page + 1, pages: pageCount, total })}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-bold disabled:opacity-40"
            >
              <span className="inline-block rtl:-scale-x-100">←</span>
            </button>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-bold disabled:opacity-40"
            >
              <span className="inline-block rtl:-scale-x-100">→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmStrip({
  message,
  onCancel,
  onConfirm,
  busy,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const t = useTranslations("adminNotifications.queue");
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
      <span className="font-semibold">{message}</span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-900 hover:bg-red-100"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}

/**
 * One row in the queue inspector. Surfaces enough metadata for the
 * admin to act: who received it, who sent it (for broadcasts), when,
 * read vs unread, links to drill into the broadcast or the user.
 */
function QueueRow({
  item: n,
  selected,
  onToggle,
  onDelete,
  onFilterByBroadcast,
  onFilterByUser,
  busy,
}: {
  item: NotificationRow;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onFilterByBroadcast: () => void;
  onFilterByUser: () => void;
  busy: boolean;
}) {
  const t = useTranslations("adminNotifications.queue");
  const locale = useLocale();
  const recipientName =
    n.recipient?.full_name?.trim() || t("unknownUser", { id: n.user_id.slice(0, 8) });
  const recipientRole = n.recipient?.role || "";
  const senderName =
    n.sender?.full_name?.trim() ||
    (n.created_by ? t("unknownAdmin", { id: n.created_by.slice(0, 8) }) : null);
  const isBroadcast = !!n.broadcast_id;

  return (
    <li
      className={`flex items-start gap-3 p-3 transition ${
        selected ? "bg-gold/5" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? t("deselect") : t("select")}
        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted hover:text-foreground"
      >
        {selected ? (
          <CheckSquare className="size-4 text-gold-bright" strokeWidth={2.2} />
        ) : (
          <Square className="size-4" strokeWidth={2.2} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {/* Tag row — kind, status, broadcast pill */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            {n.kind}
          </span>
          {n.read_at ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              {t("readAgo", { ago: formatRelativeTime(n.read_at, locale) })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-bright">
              <span className="inline-block size-1.5 rounded-full bg-gold-bright" />
              {t("unreadOne")}
            </span>
          )}
          {isBroadcast && (
            <button
              type="button"
              onClick={onFilterByBroadcast}
              className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-bright transition hover:bg-gold/25"
              title={t("filterByBroadcast")}
            >
              <Radio className="size-3" strokeWidth={2.4} />
              {t("broadcastTag", { id: n.broadcast_id!.slice(0, 8) })}
            </button>
          )}
        </div>

        {/* Title */}
        <div className="mt-1 text-[13px] font-bold text-foreground leading-tight">
          {n.title}
        </div>

        {/* Body */}
        {n.body && (
          <div className="mt-0.5 text-[12px] text-muted leading-relaxed line-clamp-2">
            {n.body}
          </div>
        )}

        {/* Link (if any) */}
        {n.link && (
          <div className="mt-1.5 truncate font-mono text-[10px] text-gold-bright">
            <span className="inline-block rtl:-scale-x-100">→</span> <Ltr>{n.link}</Ltr>
          </div>
        )}

        {/* Metadata strip — recipient, sender, timestamps. The
            recipient and broadcast id are clickable filter shortcuts so
            the admin can drill from one row into "everything that user
            got" or "everyone who got that broadcast". */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <button
            type="button"
            onClick={onFilterByUser}
            className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 transition hover:bg-foreground/10 hover:text-foreground"
            title={t("filterByRecipient")}
          >
            <User className="size-3" strokeWidth={2.2} />
            <span className="font-semibold">{recipientName}</span>
            {recipientRole && (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                · {recipientRole}
              </span>
            )}
          </button>
          {senderName && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3 text-gold-bright" strokeWidth={2.2} />
              <span>{t("by")}</span>
              <span className="font-semibold text-foreground">{senderName}</span>
            </span>
          )}
          <span title={new Date(n.created_at).toISOString()} className="font-medium">
            {formatRelativeTime(n.created_at, locale)} ·{" "}
            <span className="text-muted/80">
              {formatDate(n.created_at, locale, "dateTime")}
            </span>
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={t("delete")}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
      >
        <Trash2 className="size-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  const locale = useLocale();
  return (
    <div
      className={`rounded-xl p-3 ring-1 ${
        accent
          ? "bg-gold/10 ring-gold/30"
          : "bg-surface ring-border"
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-[20px] font-extrabold tabular-nums ${
          accent ? "text-gold-bright" : "text-foreground"
        }`}
      >
        {formatNumber(value, locale)}
      </div>
    </div>
  );
}
