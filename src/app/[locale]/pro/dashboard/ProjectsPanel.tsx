"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Ltr } from "@/components/ui/Ltr";
import { useApiError } from "@/lib/useApiError";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { delegationLabel, delegationsOf } from "@/lib/delegations";
import {
  BLOCKS,
  FLOOR_KINDS,
  LOT_KINDS,
  PROJECT_KINDS,
  UNIT_STATUSES,
  deliveryChoices,
  deliveryParts,
  parseUnitPlan,
  planUnits,
  unitPlanSize,
  type ProjectKind,
  type UnitStatus,
} from "@/lib/pro/projects";
import { cn, formatTND } from "@/lib/utils";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

/**
 * The « Projets » tab's controls (0179): the project form, its status
 * buttons, the unit generator and the units table. Choices rather than
 * typing — kinds, blocks, floors, delivery are chips and lists.
 */

const chip = (on: boolean) =>
  cn(
    "tap-target rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition",
    on ? "bg-[var(--gold)] text-[var(--background)]" : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
  );
const field = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-foreground focus:border-gold focus:outline-none";
const label = "mb-1 block text-[12.5px] font-bold text-foreground";
const hint = "mt-1 text-[11.5px] leading-snug text-muted";

/** « Livré » or « 2e trimestre 2027 », in the reader's language. */
export function useDeliveryLabel() {
  const t = useTranslations("pro.projects.delivery");
  return (v: string | null | undefined) => {
    const p = deliveryParts(v);
    if (!p) return t("none");
    return p.delivered ? t("delivered") : t("quarter", { q: String(p.q), year: String(p.year) });
  };
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

// ─── The project form ────────────────────────────────────────────────────────

export type ProjectFormValue = {
  name: string;
  kind: ProjectKind;
  governorate: string;
  delegation: string;
  address: string;
  delivery: string;
  description: string;
  cover_path: string | null;
};

export function ProjectForm({
  shopId,
  projectId,
  initial,
  today,
  defaultGovernorate,
}: {
  shopId: string;
  /** Set to edit that project; absent to create one. */
  projectId?: string;
  initial?: ProjectFormValue;
  /** The server's date, so the delivery chips match on both sides. */
  today: string;
  defaultGovernorate: string;
}) {
  const t = useTranslations("pro.projects");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const deliveryLabel = useDeliveryLabel();
  const [v, setV] = useState<ProjectFormValue>(
    initial ?? { name: "", kind: "residence", governorate: defaultGovernorate, delegation: "", address: "", delivery: "", description: "", cover_path: null },
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof ProjectFormValue>(k: K, value: ProjectFormValue[K]) => setV((x) => ({ ...x, [k]: value }));
  const delegations = useMemo(
    () => delegationsOf(v.governorate).map((d) => ({ value: d, label: delegationLabel(d, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale)),
    [v.governorate, locale],
  );
  const deliveries = useMemo(() => deliveryChoices(new Date(today)), [today]);

  async function upload(file: File) {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      toast(t("form.imageTooBig"), "warning");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "webp").toLowerCase();
      const r = await send("/api/annonces/photo-url", "POST", { exts: [ext] });
      const target = (r.json.uploads as { path: string; signedUrl: string }[] | undefined)?.[0];
      if (!r.ok || !target) {
        toast(apiError(r.json, t("form.uploadFailed")), "error");
        return;
      }
      const form = new FormData();
      form.append("cacheControl", "31536000");
      form.append("", file);
      const put = await fetch(target.signedUrl, { method: "PUT", body: form });
      if (!put.ok) {
        toast(t("form.uploadFailed"), "error");
        return;
      }
      set("cover_path", target.path);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, delegation: v.delegation || null, delivery: v.delivery || null };
      const r = projectId
        ? await send(`/api/pro/projects/${projectId}`, "PATCH", body)
        : await send(`/api/pro/shops/${shopId}/projects`, "POST", body);
      if (!r.ok) {
        toast(apiError(r.json, t("form.failed")), "error");
        return;
      }
      toast(t(projectId ? "form.saved" : "form.created"), "success");
      if (!projectId) router.push(`/pro/dashboard?shop=${shopId}&tab=projets&p=${r.json.id as string}` as never);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="relative grid aspect-[3/1] w-full cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface-2/50 text-muted transition hover:border-gold-soft">
        {v.cover_path ? (
          // eslint-disable-next-line @next/next/no-img-element -- a just-uploaded preview
          <img src={propertyPhotoUrl(v.cover_path, { transform: { width: 900, quality: 70 } })} alt="" className="absolute inset-0 size-full object-cover" />
        ) : uploading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11.5px] font-semibold">
            <ImagePlus className="size-5" /> {t("form.cover")}
          </span>
        )}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </label>

      <div>
        <label className={label} htmlFor="project-name">{t("form.name")}</label>
        <input id="project-name" className={field} value={v.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={100} placeholder={t("form.namePlaceholder")} dir="auto" />
      </div>

      <div>
        <p className={label}>{t("form.kind")}</p>
        <div className="flex flex-wrap gap-2">
          {PROJECT_KINDS.map((k) => (
            <button key={k} type="button" className={chip(v.kind === k)} aria-pressed={v.kind === k} onClick={() => set("kind", k)}>
              {t(`kinds.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="project-gov">{t("form.governorate")}</label>
          <select id="project-gov" className={field} value={v.governorate} onChange={(e) => setV((x) => ({ ...x, governorate: e.target.value, delegation: "" }))}>
            {TUNISIAN_GOVERNORATES.map((g) => (
              <option key={g} value={g}>{governorateLabel(g, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="project-del">{t("form.delegation")}</label>
          <select id="project-del" className={field} value={v.delegation} onChange={(e) => set("delegation", e.target.value)}>
            <option value="">{t("form.delegationAny")}</option>
            {delegations.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="project-address">{t("form.address")}</label>
          <input id="project-address" className={field} value={v.address} onChange={(e) => set("address", e.target.value)} maxLength={200} dir="auto" />
          <p className={hint}>{t("form.addressHint")}</p>
        </div>
      </div>

      <div>
        <p className={label}>{t("form.delivery")}</p>
        <div className="flex flex-wrap gap-2">
          {deliveries.map((d) => (
            <button key={d} type="button" className={chip(v.delivery === d)} aria-pressed={v.delivery === d} onClick={() => set("delivery", v.delivery === d ? "" : d)}>
              {deliveryLabel(d)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="project-desc">{t("form.description")}</label>
        <textarea id="project-desc" rows={5} className={cn(field, "h-auto py-2.5 leading-relaxed")} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={3000} dir="auto" />
        <p className={hint}>{t("form.descriptionHint")}</p>
      </div>

      <button type="submit" disabled={busy || uploading} className="mazed-btn-luxe tap-target px-5 py-2.5 text-[13.5px] disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t(projectId ? "form.save" : "form.create")}
      </button>
    </form>
  );
}

// ─── Status: publish, take down, delete ──────────────────────────────────────

export function ProjectStatusActions({ shopId, projectId, status }: { shopId: string; projectId: string; status: string }) {
  const t = useTranslations("pro.projects.actions");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function to(next: "published" | "archived") {
    setBusy(true);
    try {
      const r = await send(`/api/pro/projects/${projectId}`, "PATCH", { status: next });
      if (!r.ok) {
        toast(apiError(r.json, t("failed")), "error");
        return;
      }
      toast(t(next === "published" ? "published" : "archived"), "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await send(`/api/pro/projects/${projectId}`, "DELETE");
      if (!r.ok) {
        toast(apiError(r.json, t("failed")), "error");
        return;
      }
      toast(t("deleted"), "success");
      router.push(`/pro/dashboard?shop=${shopId}&tab=projets` as never);
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  const btn = "tap-target inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition disabled:opacity-60";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "published" && (
        <button type="button" disabled={busy} onClick={() => to("published")} className={cn(btn, "bg-[var(--gold)] text-[var(--background)]")}>
          {t(status === "archived" ? "republish" : "publish")}
        </button>
      )}
      {status === "published" && (
        <button type="button" disabled={busy} onClick={() => to("archived")} className={cn(btn, "border border-border text-foreground")}>
          {t("archive")}
        </button>
      )}
      {status !== "published" && (
        <button type="button" disabled={busy} onClick={() => setAsking(true)} className={cn(btn, "text-muted hover:text-[var(--tone-bad)]")}>
          <Trash2 className="size-3.5" /> {t("delete")}
        </button>
      )}
      <Modal open={asking} onClose={() => !busy && setAsking(false)} title={t("deleteTitle")} description={t("deleteBody")} size="sm">
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" disabled={busy} onClick={remove} className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--tone-bad)] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("delete")}
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking(false)} className="tap-target flex flex-1 justify-center rounded-xl border border-border px-4 py-2.5 text-[13px] font-bold text-muted">
            {t("cancel")}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ─── The unit generator ──────────────────────────────────────────────────────

const FLOORS = Array.from({ length: 31 }, (_, i) => i);

export function UnitGenerator({ projectId, maxUnits, nextLot }: { projectId: string; maxUnits: number; nextLot: number }) {
  const t = useTranslations("pro.projects");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [mode, setMode] = useState<"floors" | "lots">("floors");
  const [kind, setKind] = useState<string>("apartment");
  const [block, setBlock] = useState<string>("A");
  const [floorFrom, setFloorFrom] = useState(1);
  const [floorTo, setFloorTo] = useState(4);
  const [perFloor, setPerFloor] = useState(2);
  const [rooms, setRooms] = useState<number | null>(null);
  const [from, setFrom] = useState(nextLot);
  const [count, setCount] = useState(10);
  const [area, setArea] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const body =
    mode === "floors"
      ? { mode, kind, block, floorFrom, floorTo, perFloor, rooms, area, price }
      : { mode, kind, from, count, area, price };
  const plan = parseUnitPlan(body);
  const preview = plan ? planUnits(plan) : [];
  const size = plan ? unitPlanSize(plan) : 0;
  const floorName = (n: number) => (n === 0 ? t("generator.ground") : t("generator.floor", { n }));

  function switchMode(m: "floors" | "lots") {
    setMode(m);
    setKind(m === "floors" ? "apartment" : "land");
  }

  async function submit() {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await send(`/api/pro/projects/${projectId}/units`, "POST", body);
      if (!r.ok) {
        toast(apiError(r.json, t("units.failed")), "error");
        return;
      }
      const created = Number(r.json.created) || 0;
      const skipped = Number(r.json.skipped) || 0;
      toast(`${t("generator.done", { created })}${skipped ? ` ${t("generator.skipped", { skipped })}` : ""}`, "success");
      if (mode === "lots") setFrom(from + count);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h3 className="text-[14px] font-extrabold text-foreground">{t("generator.title")}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(mode === "floors")} aria-pressed={mode === "floors"} onClick={() => switchMode("floors")}>{t("generator.floors")}</button>
        <button type="button" className={chip(mode === "lots")} aria-pressed={mode === "lots"} onClick={() => switchMode("lots")}>{t("generator.lots")}</button>
      </div>

      <div>
        <p className={label}>{t("generator.kind")}</p>
        <div className="flex flex-wrap gap-2">
          {(mode === "floors" ? FLOOR_KINDS : LOT_KINDS).map((k) => (
            <button key={k} type="button" className={chip(kind === k)} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`unitKinds.${k}`)}</button>
          ))}
        </div>
      </div>

      {mode === "floors" ? (
        <>
          <div>
            <p className={label}>{t("generator.block")}</p>
            <div className="flex flex-wrap gap-2">
              {BLOCKS.map((b) => (
                <button key={b} type="button" className={chip(block === b)} aria-pressed={block === b} onClick={() => setBlock(b)}>{b}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="gen-from">{t("generator.floorFrom")}</label>
              <select id="gen-from" className={field} value={floorFrom} onChange={(e) => setFloorFrom(Number(e.target.value))}>
                {FLOORS.map((f) => <option key={f} value={f}>{floorName(f)}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="gen-to">{t("generator.floorTo")}</label>
              <select id="gen-to" className={field} value={floorTo} onChange={(e) => setFloorTo(Number(e.target.value))}>
                {FLOORS.filter((f) => f >= floorFrom).map((f) => <option key={f} value={f}>{floorName(f)}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="gen-per">{t("generator.perFloor")}</label>
              <select id="gen-per" className={field} value={perFloor} onChange={(e) => setPerFloor(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div>
            <p className={label}>{t("generator.rooms")}</p>
            <div className="flex flex-wrap gap-2">
              {[null, 1, 2, 3, 4, 5, 6].map((r) => (
                <button key={r ?? "none"} type="button" className={chip(rooms === r)} aria-pressed={rooms === r} onClick={() => setRooms(r)}>{r ?? t("generator.roomsAny")}</button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="gen-start">{t("generator.from")}</label>
            <input id="gen-start" type="number" min={1} max={9999} className={field} value={from} onChange={(e) => setFrom(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div>
            <label className={label} htmlFor="gen-count">{t("generator.count")}</label>
            <input id="gen-count" type="number" min={1} max={maxUnits} className={field} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="gen-area">{t("generator.area")}</label>
          <input id="gen-area" type="number" min={1} inputMode="decimal" className={field} value={area} onChange={(e) => setArea(e.target.value)} />
          <p className={hint}>{t("generator.optional")}</p>
        </div>
        <div>
          <label className={label} htmlFor="gen-price">{t("generator.price")}</label>
          <input id="gen-price" type="number" min={1} inputMode="decimal" className={field} value={price} onChange={(e) => setPrice(e.target.value)} />
          <p className={hint}>{t("generator.optional")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!plan || size > maxUnits || busy} onClick={submit} className="mazed-btn-luxe tap-target px-5 py-2.5 text-[13.5px] disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("generator.submit")}
        </button>
        {plan && (
          <span className="text-[12.5px] text-muted">
            {size > maxUnits
              ? t("generator.tooMany", { max: maxUnits })
              : t("generator.preview", { count: size, first: preview[0]?.ref ?? "", last: preview.at(-1)?.ref ?? "" })}
          </span>
        )}
      </div>
    </section>
  );
}

// ─── The units table ─────────────────────────────────────────────────────────

export type UnitRow = {
  id: string;
  ref: string;
  kind: string;
  floor: number | null;
  rooms: number | null;
  area_sqm: number | null;
  price: number | null;
  status: UnitStatus;
};

const STATUS_TONE: Record<UnitStatus, string> = {
  available: "mazed-tone-ok",
  reserved: "mazed-tone-warn",
  sold: "bg-surface-2 text-muted ring-1 ring-border",
};

export function UnitsTable({ projectId, units }: { projectId: string; units: UnitRow[] }) {
  const t = useTranslations("pro.projects");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function patch(unitIds: string[], change: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await send(`/api/pro/projects/${projectId}/units`, "PATCH", { unitIds, ...change });
      if (!r.ok) {
        toast(apiError(r.json, t("units.failed")), "error");
        return;
      }
      toast(t("units.saved"), "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await send(`/api/pro/projects/${projectId}/units`, "DELETE", { unitIds: [...selected] });
      if (!r.ok) {
        toast(apiError(r.json, t("units.failed")), "error");
        return;
      }
      toast(t("units.deleted"), "success");
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = units.length > 0 && selected.size === units.length;
  const floorName = (n: number | null) => (n === null ? "—" : n === 0 ? t("generator.ground") : String(n));

  if (units.length === 0) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted">{t("units.empty")}</p>;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-extrabold text-foreground">{t("units.title", { count: units.length })}</h3>
        {selected.size > 0 && (
          <div className="ms-auto flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="font-bold text-foreground">{t("units.selected", { count: selected.size })}</span>
            <span className="text-muted">{t("units.setStatus")}</span>
            {UNIT_STATUSES.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => patch([...selected], { status: s })} className={cn("rounded-full px-2.5 py-1 font-bold", STATUS_TONE[s])}>
                {t(`unitStatus.${s}`)}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => setAsking(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold text-muted hover:text-[var(--tone-bad)]">
              <Trash2 className="size-3.5" /> {t("units.delete")}
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="bg-surface-2 text-start text-[11.5px] uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" aria-label={t("units.selectAll")} checked={all} onChange={() => setSelected(all ? new Set() : new Set(units.map((u) => u.id)))} className="accent-[var(--gold)]" />
              </th>
              <th className="px-2 py-2 text-start">{t("units.ref")}</th>
              <th className="px-2 py-2 text-start">{t("units.kind")}</th>
              <th className="px-2 py-2 text-start">{t("units.floor")}</th>
              <th className="px-2 py-2 text-start">{t("units.rooms")}</th>
              <th className="px-2 py-2 text-start">{t("units.area")}</th>
              <th className="px-2 py-2 text-start">{t("units.price")}</th>
              <th className="px-2 py-2 text-start">{t("units.status")}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={u.ref} checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-[var(--gold)]" />
                </td>
                <td className="px-2 py-2 font-bold text-foreground"><Ltr>{u.ref}</Ltr></td>
                <td className="px-2 py-2 text-muted">{t(`unitKinds.${u.kind}`)}</td>
                <td className="px-2 py-2 text-muted">{floorName(u.floor)}</td>
                <td className="px-2 py-2 text-muted">{u.rooms ?? "—"}</td>
                <td className="px-2 py-2 text-muted">{u.area_sqm ? <Ltr>{`${u.area_sqm} m²`}</Ltr> : "—"}</td>
                <td className="px-2 py-2 text-foreground">{u.price ? formatTND(u.price, locale) : "—"}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    {UNIT_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy || u.status === s}
                        aria-pressed={u.status === s}
                        onClick={() => patch([u.id], { status: s })}
                        className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold transition", u.status === s ? STATUS_TONE[s] : "text-muted hover:text-foreground")}
                      >
                        {t(`unitStatus.${s}`)}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={asking} onClose={() => !busy && setAsking(false)} title={t("units.deleteTitle", { count: selected.size })} size="sm">
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" disabled={busy} onClick={remove} className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--tone-bad)] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("units.delete")}
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking(false)} className="tap-target flex flex-1 justify-center rounded-xl border border-border px-4 py-2.5 text-[13px] font-bold text-muted">
            {t("actions.cancel")}
          </button>
        </div>
      </Modal>
    </section>
  );
}
