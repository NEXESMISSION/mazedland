import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { ApproveInspectorButton } from "@/components/admin/ApproveInspectorButton";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 30;

const STATUSES = [
  { key: "all", label: "Tous" },
  { key: "pending", label: "En attente" },
  { key: "approved", label: "Approuvés" },
] as const;

/**
 * Inspector accreditation queue. Approve an applicant → unlocks them on
 * /inspectors and in the booking flow. Now server-paginated with search
 * (name / phone) + a status filter, in line with every other admin queue
 * (was an unbounded full-table load).
 */
export default async function AdminInspectors({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; range?: string; page?: string }>;
}) {
  const { q: qP, status: statusP, range: rangeP, page: pageP } = await searchParams;
  const supabase = await getServerSupabase();

  const q = (qP ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const status = STATUSES.some((s) => s.key === statusP) ? statusP! : "all";
  const sinceDays = rangeP === "1" || rangeP === "7" || rangeP === "30" ? Number(rangeP) : null;
  const page = Math.max(1, Number(pageP) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("inspectors")
    .select(
      `
      id, speciality, governorates, approved, created_at,
      profile:profiles!inner (full_name, phone)
    `,
      { count: "exact" },
    );
  if (status === "approved") query = query.eq("approved", true);
  else if (status === "pending") query = query.eq("approved", false);
  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`, { referencedTable: "profile" });
  if (sinceDays) query = query.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count } = await query;
  const rows = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const base = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      q: q || undefined,
      status: status !== "all" ? status : undefined,
      range: rangeP,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return (`/admin/inspectors${s ? `?${s}` : ""}`) as "/admin/inspectors";
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="Personnes · Accréditation"
        title="Inspecteurs"
        description="Approuvez les candidats → ils sont débloqués sur /inspectors et dans le parcours de réservation."
      />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s.key}
            href={base({ status: s.key === "all" ? undefined : s.key, page: undefined })}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
              status === s.key
                ? "border-[var(--gold)] bg-[var(--gold)] text-white"
                : "border-border bg-surface text-muted hover:border-gold-soft hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <AdminQueryBar total={total} placeholder="Nom ou téléphone…" />

      {rows.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          Aucun inspecteur ne correspond.
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {rows.map((i) => {
            const p = (i as unknown as { profile: { full_name: string | null; phone: string | null } }).profile;
            return (
              <div
                key={i.id as string}
                className="rounded-xl bg-surface p-4 ring-1 ring-border transition-all hover:ring-gold-soft/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span className="batta-monogram size-10 shrink-0 not-italic text-[13px] font-extrabold">
                      {(p.full_name ?? "?")
                        .split(" ")
                        .map((part) => part[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-bold text-foreground">
                        {p.full_name ?? "(sans nom)"}
                      </div>
                      <div className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                        {(i.speciality as string).replace(/_/g, " ")} · {p.phone ?? "—"}
                      </div>
                      <div className="mt-1 text-[10px] text-muted">
                        {((i.governorates as string[]) ?? []).join(", ") || "—"}
                      </div>
                    </div>
                  </div>
                  <StatusBadge tone={i.approved ? "ok" : "warn"}>
                    {i.approved ? "Approuvé" : "En attente"}
                  </StatusBadge>
                </div>
                {!i.approved && (
                  <>
                    <div aria-hidden className="batta-hairline mt-3" />
                    <div className="mt-3 flex justify-end">
                      <ApproveInspectorButton id={i.id as string} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
