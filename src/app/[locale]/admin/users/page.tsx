import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { ShieldCheck, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 30;

const ROLES = [
  { key: "all", label: "Tous" },
  { key: "individual", label: "Particuliers" },
  { key: "bank", label: "Banques" },
  { key: "agency", label: "Agences" },
  { key: "bailiff", label: "Huissiers" },
  { key: "inspector", label: "Inspecteurs" },
  { key: "admin", label: "Admins" },
] as const;
const ROLE_LABEL: Record<string, string> = {
  individual: "Particulier", bank: "Banque", agency: "Agence",
  bailiff: "Huissier", inspector: "Inspecteur", admin: "Admin",
};
const KYC = [
  { key: "all", label: "Tous KYC" },
  { key: "verified", label: "Vérifiés" },
  { key: "submitted", label: "En attente" },
  { key: "rejected", label: "Rejetés" },
  { key: "none", label: "Non vérifiés" },
] as const;
const KYC_TONE: Record<string, { label: string; tone: string }> = {
  verified: { label: "Vérifié", tone: "batta-tone-ok" },
  submitted: { label: "En vérif.", tone: "batta-tone-warn" },
  pending: { label: "En attente", tone: "batta-tone-warn" },
  rejected: { label: "Rejeté", tone: "batta-tone-bad" },
  none: { label: "Non vérifié", tone: "bg-surface-2 text-muted ring-1 ring-border" },
};

/**
 * Real user directory (was a duplicate KYC list). Browse/search every
 * profile by name or phone, filter by role + KYC status, server-paginated.
 * KYC review itself lives on /admin/kyc-queue.
 */
export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; kyc?: string; range?: string; page?: string }>;
}) {
  const { q: qP, role: roleP, kyc: kycP, range: rangeP, page: pageP } = await searchParams;
  const sb = await getServerSupabase();

  const q = (qP ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const role = ROLES.some((r) => r.key === roleP) ? roleP! : "all";
  const kyc = KYC.some((k) => k.key === kycP) ? kycP! : "all";
  const sinceDays = rangeP === "1" || rangeP === "7" || rangeP === "30" ? Number(rangeP) : null;
  const page = Math.max(1, Number(pageP) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = sb
    .from("profiles")
    .select("id, full_name, phone, role, kyc_status, governorate, created_at, trust_score", { count: "exact" });
  if (role !== "all") query = query.eq("role", role);
  if (kyc !== "all") query = query.eq("kyc_status", kyc);
  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  if (sinceDays) query = query.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count } = await query;
  const rows = (data ?? []) as Array<{
    id: string; full_name: string | null; phone: string | null; role: string;
    kyc_status: string; governorate: string | null; created_at: string; trust_score: number | null;
  }>;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Preserve filters across pill links.
  const base = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      q: q || undefined,
      role: role !== "all" ? role : undefined,
      kyc: kyc !== "all" ? kyc : undefined,
      range: rangeP,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return (`/admin/users${s ? `?${s}` : ""}`) as "/admin/users";
  };

  return (
    <div>
      <span className="batta-eyebrow">Personnes · Annuaire</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">Utilisateurs</h2>
      <p className="mt-1 text-[12px] text-muted">
        Rechercher et filtrer les comptes. La vérification d&apos;identité se fait dans la file KYC.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {ROLES.map((r) => (
          <Link
            key={r.key}
            href={base({ role: r.key === "all" ? undefined : r.key, page: undefined })}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
              role === r.key ? "border-[var(--gold)] bg-[var(--gold)] text-white" : "border-border bg-surface text-muted hover:border-gold-soft"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {KYC.map((k) => (
          <Link
            key={k.key}
            href={base({ kyc: k.key === "all" ? undefined : k.key, page: undefined })}
            className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold transition-colors ${
              kyc === k.key ? "bg-gold-faint text-gold ring-1 ring-gold/30" : "text-muted hover:text-foreground"
            }`}
          >
            {k.label}
          </Link>
        ))}
      </div>

      <AdminQueryBar total={total} placeholder="Nom ou téléphone…" />

      {rows.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          Aucun utilisateur ne correspond.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
          <ul className="divide-y divide-border">
            {rows.map((u) => {
              const k = KYC_TONE[u.kyc_status] ?? KYC_TONE.none;
              const initials = (u.full_name ?? "?").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              return (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="batta-monogram size-10 shrink-0 not-italic text-[13px] font-extrabold">{initials}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-foreground">{u.full_name ?? "—"}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                      {u.phone && <span className="batta-tabular">{u.phone}</span>}
                      {u.governorate && (
                        <>
                          <span aria-hidden className="opacity-40">·</span>
                          <span className="inline-flex items-center gap-0.5"><MapPin className="size-3" /> {u.governorate}</span>
                        </>
                      )}
                      <span aria-hidden className="opacity-40">·</span>
                      <span>Inscrit {new Date(u.created_at).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </div>
                  {u.role !== "individual" && (
                    <span className="batta-pill-gold shrink-0">{ROLE_LABEL[u.role] ?? u.role}</span>
                  )}
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${k.tone}`}>
                    {u.kyc_status === "verified" && <ShieldCheck className="size-3" strokeWidth={2.5} />}
                    {k.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
