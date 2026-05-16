import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { KycQueueList, type KycSubmissionView } from "./KycQueueList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TABS = [
  { value: "submitted", label: "En attente" },
  { value: "verified", label: "Approuvés" },
  { value: "rejected", label: "Rejetés" },
  { value: "all", label: "Tous" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["value"];

/**
 * Admin KYC review queue. Lists `kyc_submissions` filtered by status,
 * with signed URLs for every CIN photo + liveness selfie / triptych
 * (the `kyc` bucket is private; we mint 60-min signed URLs server-side
 * so the admin can render them without exposing the storage paths to
 * the client).
 *
 * Replaces the previous flat /admin/users KYC list with a focused
 * queue + photo preview + approve / reject CTAs per submission.
 */
export default async function KYCQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const supabase = await getServerSupabase();

  const status: StatusTab = STATUS_TABS.some((s) => s.value === statusParam)
    ? (statusParam as StatusTab)
    : "submitted";

  let query = supabase
    .from("kyc_submissions")
    .select(
      "id, user_id, full_name, id_front_url, id_back_url, selfie_video_url, selfie_image_url, status, rejection_reason, submitted_at, reviewed_at",
    );
  if (status !== "all") {
    query = query.eq("status", status);
  }
  // Pending sorts oldest-first (FIFO work queue); the archive sorts
  // newest-first (most recent decisions on top).
  query = query.order("submitted_at", { ascending: status === "submitted" });

  const { data, error } = await query;
  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    full_name: string | null;
    id_front_url: string;
    id_back_url: string;
    selfie_video_url: string | null;
    selfie_image_url: string | null;
    status: string;
    rejection_reason: string | null;
    submitted_at: string;
    reviewed_at: string | null;
  }>;

  // Sign every storage path so the client can render the private kyc
  // bucket. Uses the authed admin's client (not the service role) —
  // RLS policy `kyc_owner_read` grants is_admin() callers SELECT on
  // every object in the bucket, which is enough for createSignedUrl.
  // One round-trip per submission × 4 paths is fine at admin volumes
  // (<100 pending at any time); for higher throughput we'd batch via
  // a single RPC.
  const items: KycSubmissionView[] = await Promise.all(
    rows.map(async (row) => {
      const sign = async (path: string | null): Promise<string | null> => {
        if (!path) return null;
        // Defensive: if the column already holds a fully-qualified URL
        // (older submissions from before the column rename) just pass
        // it through. New submissions store paths.
        if (path.startsWith("http://") || path.startsWith("https://")) {
          return path;
        }
        const { data: signed, error } = await supabase.storage
          .from("kyc")
          .createSignedUrl(path, 3600);
        if (error || !signed?.signedUrl) {
          console.error("[kyc-queue] createSignedUrl failed", {
            path,
            message: error?.message,
          });
          return null;
        }
        return signed.signedUrl;
      };
      return {
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name,
        status: row.status,
        rejection_reason: row.rejection_reason,
        submitted_at: row.submitted_at,
        reviewed_at: row.reviewed_at,
        id_front_url: await sign(row.id_front_url),
        id_back_url: await sign(row.id_back_url),
        selfie_video_url: await sign(row.selfie_video_url),
        selfie_image_url: await sign(row.selfie_image_url),
      };
    }),
  );

  return (
    <div>
      <span className="batta-eyebrow">Identity desk</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">
          File KYC
        </h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
            status === "submitted"
              ? "batta-tone-warn"
              : "bg-surface-2 text-muted ring-1 ring-border"
          }`}
        >
          {items.length}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Vérifiez l&apos;identité avant que l&apos;utilisateur ne puisse enchérir.
        Les rejets envoient une notification à l&apos;utilisateur.
      </p>

      {/* Status tabs — shareable + survives a refresh. */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = tab.value === status;
          return (
            <Link
              key={tab.value}
              href={
                (tab.value === "submitted"
                  ? "/admin/kyc-queue"
                  : `/admin/kyc-queue?status=${tab.value}`) as `/admin/kyc-queue`
              }
              className={`px-3 h-8 inline-flex items-center rounded-full text-xs font-bold border transition-colors ${
                active
                  ? "bg-[var(--gold)] text-black border-[var(--gold)]"
                  : "bg-[var(--surface)] text-[var(--foreground-muted)] border-[var(--border)] hover:border-[var(--gold-soft)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--radius-md)] bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {items.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          {status === "submitted"
            ? "Aucune soumission en attente."
            : "Aucune soumission dans cette vue."}
        </div>
      ) : (
        <div className="mt-5">
          <KycQueueList items={items} view={status} />
        </div>
      )}
    </div>
  );
}
