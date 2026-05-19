"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

// ─── Per-kind form schema ────────────────────────────────────────────────────
// Each broadcast type has a different shape: titles + bodies are
// universal, but maintenance carries a scheduled time, promos carry an
// expiry + promo code, alerts carry a severity, etc. Title / body /
// link land in their dedicated columns on notifications; everything
// else is stored in notifications.payload (jsonb) via the
// broadcast_notification RPC. To add a new kind, append an entry here
// and the form + payload builder pick it up — no other code changes
// needed.

type FieldType = "text" | "textarea" | "url" | "datetime" | "number" | "select" | "checkbox";

type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: { value: string; label: string }[];
  helper?: string;
};

type KindDef = {
  value: string;
  label: string;
  description: string;
  fields: FieldDef[];
};

// Fields whose key is one of these go into top-level notification
// columns; everything else flows into payload jsonb.
const CORE_FIELD_KEYS = new Set(["title", "body", "link"]);

const KIND_CONFIG: KindDef[] = [
  {
    value: "announcement",
    label: "Annonce",
    description: "Nouvelle fonctionnalité, changement de politique, communication produit.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Nouvelle fonctionnalité disponible" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Décrivez l'annonce." },
      { key: "link", label: "Lien (optionnel)", type: "url", maxLength: 500, placeholder: "/auctions" },
      { key: "cta_label", label: "Libellé du bouton", type: "text", maxLength: 60, placeholder: "En savoir plus", helper: "Texte du bouton d'action affiché avec le lien." },
    ],
  },
  {
    value: "maintenance",
    label: "Maintenance",
    description: "Indisponibilité planifiée, fenêtre de maintenance.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Maintenance programmée" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails de la maintenance." },
      { key: "scheduled_at", label: "Début prévu", type: "datetime", required: true, helper: "Heure locale (Tunis)." },
      { key: "duration_min", label: "Durée (minutes)", type: "number", placeholder: "60" },
      { key: "affected", label: "Services impactés", type: "text", maxLength: 200, placeholder: "Enchères, paiements" },
    ],
  },
  {
    value: "promo",
    label: "Promo / actualité",
    description: "Offre limitée, événement, mise en avant d'une enchère.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Enchère spéciale ce week-end" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails de la promo." },
      { key: "link", label: "Lien", type: "url", maxLength: 500, placeholder: "/auctions/abc" },
      { key: "cta_label", label: "Libellé du bouton", type: "text", maxLength: 60, placeholder: "Voir l'offre" },
      { key: "expires_at", label: "Expire le", type: "datetime", helper: "L'offre n'est plus valable après cette date." },
      { key: "promo_code", label: "Code promo", type: "text", maxLength: 40, placeholder: "BATTA2026" },
    ],
  },
  {
    value: "system_alert",
    label: "Alerte système",
    description: "Incident, problème connu, instruction d'action urgente.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Problème de paiement détecté" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails du problème et de la solution." },
      {
        key: "severity",
        label: "Sévérité",
        type: "select",
        required: true,
        options: [
          { value: "info", label: "Info" },
          { value: "warning", label: "Avertissement" },
          { value: "error", label: "Critique" },
        ],
      },
      { key: "action_required", label: "Action requise de l'utilisateur", type: "checkbox" },
    ],
  },
];

const KIND_BY_VALUE = new Map(KIND_CONFIG.map((k) => [k.value, k]));

export function AdminNotificationsClient() {
  const [tab, setTab] = useState<"compose" | "queue">("compose");

  return (
    <div>
      <div className="flex gap-1.5 rounded-full bg-surface p-1 ring-1 ring-border w-fit">
        <TabButton active={tab === "compose"} onClick={() => setTab("compose")}>
          <Send className="size-3.5" strokeWidth={2} />
          Composer
        </TabButton>
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          <Inbox className="size-3.5" strokeWidth={2} />
          File
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
        <Field label="Type">
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
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {config.description}
          </p>
        </Field>

        {config.fields.map((f) => (
          <DynamicField
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </div>

      <div className="space-y-4">
        <Field label="Destinataires">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "role", "users"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAudienceType(t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ring-1 transition ${
                  audienceType === t
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-surface text-muted ring-border hover:text-foreground"
                }`}
              >
                {t === "all" ? "Tous" : t === "role" ? "Par rôle" : "Utilisateurs"}
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
              className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px]"
              placeholder="ID utilisateur, un par ligne (ou séparés par virgule)"
            />
          )}
        </Field>

        <Field label="Aperçu">
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
            Envoyer un test à moi
          </button>
          <button
            type="button"
            onClick={() => send(false)}
            disabled={!canSend}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-background transition hover:bg-gold-bright disabled:opacity-50"
          >
            <Send className="size-3.5" strokeWidth={2.4} />
            {sending ? "Envoi..." : "Diffuser"}
          </button>
          {missingRequired && (
            <p className="text-center text-[10px] uppercase tracking-[0.12em] text-muted">
              Champs requis manquants
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
                  {result.test ? "Test envoyé." : "Diffusion envoyée."}
                </span>{" "}
                {result.count} destinataire{result.count > 1 ? "s" : ""}
                {!result.test && (
                  <>
                    {" "}
                    · <span className="font-mono text-[10px]">{result.broadcast_id.slice(0, 8)}</span>
                  </>
                )}
              </>
            ) : (
              <>Erreur : {result.error}</>
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
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const str = value === undefined || value === null ? "" : String(value);

  return (
    <Field label={field.label} required={field.required}>
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
                  placeholder={field.placeholder}
                  className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] ${
                    field.type === "url" ? "font-mono text-[12px]" : ""
                  }`}
                />
                {field.maxLength && (
                  <div className="mt-1 text-right text-[10px] uppercase tracking-[0.12em] text-muted">
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
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px]"
                />
                {field.maxLength && (
                  <div className="mt-1 text-right text-[10px] uppercase tracking-[0.12em] text-muted">
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
                placeholder={field.placeholder}
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
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
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
                <span>Oui</span>
              </label>
            );
          default:
            return null;
        }
      })()}
      {field.helper && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">
          {field.helper}
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
        Payload
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
  return (
    <div className="rounded-2xl bg-surface p-3 ring-1 ring-border">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-bright">
          <Send className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-foreground leading-tight">
            {title || "Titre de la notification"}
          </div>
          {body && (
            <div className="mt-1 text-[12px] text-muted leading-relaxed">
              {body}
            </div>
          )}
          {link && (
            <div className="mt-1.5 truncate font-mono text-[10px] text-gold-bright">
              → {link}
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
        setError("Échec du chargement");
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
  }, [queryString]);

  useEffect(() => {
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
    console.groupCollapsed(`[admin-queue] deleteOne(${id.slice(0, 8)}…)`);
    setBusy(true);
    setError(null);
    try {
      console.log("DELETE /api/admin/notifications/" + id);
      const res = await fetch(`/api/admin/notifications/${id}`, {
        method: "DELETE",
      });
      console.log("response status:", res.status, res.statusText);
      const payload = await res.json().catch(() => ({}));
      console.log("response body:", payload);
      if (!res.ok) {
        console.warn("server returned !ok");
        setError("Échec de la suppression");
        return;
      }
      setItems((arr) => arr.filter((x) => x.id !== id));
      setTotal((n) => Math.max(0, n - 1));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      console.log("✓ removed locally");
    } finally {
      setBusy(false);
      console.groupEnd();
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    console.groupCollapsed(`[admin-queue] deleteSelected (${selected.size})`);
    setBusy(true);
    setError(null);
    setConfirmingSelection(false);
    const ids = [...selected];
    try {
      console.log("POST /api/admin/notifications/bulk-delete  body:", { ids });
      const res = await fetch("/api/admin/notifications/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      console.log("response status:", res.status, res.statusText);
      const payload = await res.json().catch(() => ({}));
      console.log("response body:", payload);
      if (!res.ok) {
        console.warn("server returned !ok");
        setError("Échec de la suppression");
        return;
      }
      const { deletedCount } = payload as { deletedCount?: number };
      console.log("deletedCount:", deletedCount);
      if (deletedCount === 0) {
        console.warn(
          "deletedCount=0 → RLS rejected or rows already gone. The selection ids:",
          ids,
        );
      }
      setSelected(new Set());
      await refresh();
      setError(
        typeof deletedCount === "number"
          ? `${deletedCount} notification${deletedCount > 1 ? "s" : ""} supprimée${deletedCount > 1 ? "s" : ""}.`
          : null,
      );
    } finally {
      setBusy(false);
      console.groupEnd();
    }
  }

  async function deleteFiltered() {
    if (!hasActiveFilters) return;
    console.groupCollapsed("[admin-queue] deleteFiltered");
    console.log("active filters:", filters);
    setBusy(true);
    setError(null);
    setConfirmingFiltered(false);
    try {
      console.log("POST /api/admin/notifications/bulk-delete  body:", { filters });
      const res = await fetch("/api/admin/notifications/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });
      console.log("response status:", res.status, res.statusText);
      const payload = await res.json().catch(() => ({}));
      console.log("response body:", payload);
      if (!res.ok) {
        console.warn("server returned !ok");
        setError("Échec de la suppression");
        return;
      }
      const { deletedCount } = payload as { deletedCount?: number };
      console.log("deletedCount:", deletedCount);
      if (deletedCount === 0) {
        console.warn(
          "deletedCount=0 → the WHERE clause matched nothing. " +
            "Check the filters above vs. what's actually in the queue.",
        );
      }
      setSelected(new Set());
      await refresh();
      setError(
        typeof deletedCount === "number"
          ? `${deletedCount} notification${deletedCount > 1 ? "s" : ""} supprimée${deletedCount > 1 ? "s" : ""}.`
          : null,
      );
    } finally {
      setBusy(false);
      console.groupEnd();
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
        <StatCard label="24 heures" value={stats?.last24h ?? 0} />
        <StatCard label="7 jours" value={stats?.last7d ?? 0} />
        <StatCard label="Non lues" value={stats?.unread ?? 0} accent />
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => {
              setFilters((f) => ({ ...f, q: e.target.value }));
              setPage(0);
            }}
            placeholder="Recherche titre…"
            className="rounded-full border border-border bg-surface py-1.5 pl-7 pr-3 text-[12px]"
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
          Non lues
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
            Réinitialiser
          </button>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:border-gold/40 hover:text-foreground"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} strokeWidth={2.4} />
          Rafraîchir
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
            {allOnPageSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          {selected.size > 0 && (
            <span className="font-bold text-foreground">
              {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
            </span>
          )}
          <span className="ms-2">
            {total} résultat{total > 1 ? "s" : ""}
            {hasActiveFilters && " (filtrés)"}
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
              Supprimer la sélection
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
              Supprimer tout (filtré)
            </button>
          )}
        </div>
      </div>

      {/* Inline confirms — replace native confirm() so the dialog stays
          inside the styled admin shell. */}
      {confirmingSelection && (
        <ConfirmStrip
          message={`Supprimer ${selected.size} notification${selected.size > 1 ? "s" : ""} sélectionnée${selected.size > 1 ? "s" : ""} ?`}
          onCancel={() => setConfirmingSelection(false)}
          onConfirm={() => void deleteSelected()}
          busy={busy}
        />
      )}
      {confirmingFiltered && (
        <ConfirmStrip
          message={`Supprimer toutes les notifications correspondant aux filtres (${total} ligne${total > 1 ? "s" : ""}) ?`}
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
              Aucune notification ne correspond aux filtres.
            </li>
          )}
        </ul>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted">
          <span>
            Page {page + 1} / {pageCount} · {total} total
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-bold disabled:opacity-40"
            >
              ←
            </button>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-bold disabled:opacity-40"
            >
              →
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
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
      <span className="font-semibold">{message}</span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-900 hover:bg-red-100"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
        >
          Confirmer
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
  const recipientName = n.recipient?.full_name?.trim() || `user · ${n.user_id.slice(0, 8)}`;
  const recipientRole = n.recipient?.role || "";
  const senderName = n.sender?.full_name?.trim() || (n.created_by ? `admin · ${n.created_by.slice(0, 8)}` : null);
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
        aria-label={selected ? "Désélectionner" : "Sélectionner"}
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
              Lue · {timeAgo(n.read_at)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-bright">
              <span className="inline-block size-1.5 rounded-full bg-gold-bright" />
              Non lue
            </span>
          )}
          {isBroadcast && (
            <button
              type="button"
              onClick={onFilterByBroadcast}
              className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-bright transition hover:bg-gold/25"
              title="Filtrer par cette diffusion"
            >
              <Radio className="size-3" strokeWidth={2.4} />
              Diffusion · {n.broadcast_id!.slice(0, 8)}
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
            → {n.link}
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
            title="Filtrer par destinataire"
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
              <span>par</span>
              <span className="font-semibold text-foreground">{senderName}</span>
            </span>
          )}
          <span title={new Date(n.created_at).toISOString()} className="font-medium">
            {timeAgo(n.created_at)} ·{" "}
            <span className="text-muted/80">
              {new Date(n.created_at).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Supprimer"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
      >
        <Trash2 className="size-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  const w = Math.floor(d / 7);
  if (w < 5) return `il y a ${w} sem`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  const y = Math.floor(d / 365);
  return `il y a ${y} an${y > 1 ? "s" : ""}`;
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
        {value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}
