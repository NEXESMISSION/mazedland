import { getServerSupabase } from "@/lib/supabase/server";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

export default async function AdminWaitlist({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string; page?: string }>;
}) {
  const { q: qP, range: rangeP, page: pageP } = await searchParams;
  const supabase = await getServerSupabase();

  const q = (qP ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const sinceDays = rangeP === "1" || rangeP === "7" || rangeP === "30" ? Number(rangeP) : null;
  const page = Math.max(1, Number(pageP) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase.from("waitlist").select("*", { count: "exact" });
  if (q) query = query.or(`email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (sinceDays) query = query.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <AdminPageHeader
        eyebrow="Avant lancement"
        title="Liste d'attente"
        description="Inscriptions avant lancement. Recherchez par e-mail ou téléphone."
        actions={<span className="batta-pill-gold">{total} inscrit{total > 1 ? "s" : ""}</span>}
      />

      <AdminQueryBar total={total} placeholder="E-mail ou téléphone…" />

      <div className="mt-5 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        <ul className="divide-y divide-border">
          {(data ?? []).map((w) => (
            <li key={w.id as string} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-foreground">
                  {w.email as string}
                </div>
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                  {(w.phone as string | null) ?? "—"} · {w.locale as string} ·{" "}
                  {(w.source as string | null) ?? "—"}
                </div>
              </div>
              <div className="batta-tabular shrink-0 text-[10px] text-muted">
                {new Date(w.created_at as string).toLocaleDateString("fr-FR")}
              </div>
            </li>
          ))}
          {(!data || data.length === 0) && (
            <li className="p-8 text-center text-[13px] text-muted">Aucune inscription.</li>
          )}
        </ul>
      </div>

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
