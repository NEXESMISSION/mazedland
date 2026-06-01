import { notFound, redirect as nextRedirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { RejectPropertyForm } from "@/components/admin/RejectPropertyForm";
import {
  ArrowLeft, MapPin, User, AlertTriangle, ShieldOff,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dedicated "refuser une annonce" surface. The previous flow popped a
 * portal modal off the queue list — fine for a 1-line reason, but bad
 * when the admin actually needs to study the listing before refusing.
 * A full page gives room for the property recap, common-reason chips,
 * a longer textarea, and a clear back-out without losing the queue.
 */
export default async function RejectPropertyPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    nextRedirect(`/${locale}/login?next=/admin/properties/${id}/reject`);
  }

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user!.id).single();
  if (profile?.role !== "admin") notFound();

  const { data: property } = await supabase
    .from("properties")
    .select(`
      id, title, status, governorate, type, area_sqm,
      owner:profiles!properties_owner_id_fkey(id, full_name, phone, kyc_status),
      photos:property_photos(id, storage_path, sort_order)
    `)
    .eq("id", id)
    .maybeSingle();

  if (!property) notFound();
  // If already resolved, bounce back to the detail view — nothing left
  // to refuse, and we don't want the admin to send a duplicate
  // rejection notification.
  if (property.status === "ready" || property.status === "rejected") {
    nextRedirect(`/${locale}/admin/properties/${id}`);
  }

  const owner = Array.isArray(property.owner) ? property.owner[0] : property.owner;
  const cover = (property.photos ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  )[0];
  const coverUrl = cover ? propertyPhotoUrl(cover.storage_path) : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 lg:py-8">
      {/* Back link to detail (so the admin can re-read full info if they
          changed their mind on the way to the refuse form). */}
      <Link
        href={`/admin/properties/${id}` as `/admin/properties/${string}`}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Retour à l'annonce
      </Link>

      <header className="mt-3 flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-faint)] text-[var(--danger)] ring-1 ring-[var(--accent-soft)]">
          <ShieldOff className="size-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="batta-eyebrow text-[10px] text-[var(--accent-deep)]">Refuser une annonce</span>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight">
            Motif de refus
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Soyez explicite : le vendeur lit ce message en notification et doit
            pouvoir corriger sans nous re-contacter.
          </p>
        </div>
      </header>

      {/* Property recap card — keeps the admin oriented on which listing
          they are about to refuse, especially after deep-linking. */}
      <section className="mt-5 overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
        <div className="flex gap-3 p-3">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt={property.title}
              className="size-20 shrink-0 rounded-xl object-cover ring-1 ring-border"
            />
          ) : (
            <div className="grid size-20 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted ring-1 ring-border">
              <AlertTriangle className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-[14px] font-bold leading-snug text-foreground">
              {property.title}
            </h2>
            <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">
              <MapPin className="size-3" /> {property.governorate} · {property.type}
              {property.area_sqm ? ` · ${property.area_sqm} m²` : null}
            </p>
            {owner && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">
                <User className="size-3" />
                {owner.full_name ?? "—"}
                <span className="text-[10px] uppercase tracking-[0.1em]">
                  · KYC {owner.kyc_status ?? "n/a"}
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="mt-5">
        <RejectPropertyForm propertyId={id} />
      </div>
    </div>
  );
}
