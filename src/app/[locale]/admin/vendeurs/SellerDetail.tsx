"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  StatusPill, Confirm, SelectField, NumberField, TextareaField,
  FieldGrid, useAdminAction, EYEBROW,
} from "@/components/admin/kit";
import {
  BadgeCheck, ShieldOff, Ticket, ChevronLeft, ExternalLink, Ban, RotateCcw,
} from "lucide-react";

/**
 * The right pane: one account, and the four levers an admin has over it —
 * role, badge, credits, ban.
 *
 * `/admin/users` and `/admin/sellers` used to be separate screens, so
 * answering "why can this agency publish for free?" meant opening both and
 * matching names by eye. They are one pane now, because they are one question.
 */

export type SellerDetailData = {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  governorate: string | null;
  createdAt: string;
  bannedAt: string | null;
  bannedReason: string | null;
  listings: { published: number; total: number };
  credits: { remaining: number; total: number; expiresAt: string | null };
  badge: { expiresAt: string | null } | null;
  payments: { captured: number; amount: number };
  packs: { id: string; label: string; quota: number | null }[];
};

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-[5px]">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}

export function SellerDetail({
  seller,
  backHref,
}: {
  seller: SellerDetailData;
  backHref: string;
}) {
  const { run, pending } = useAdminAction();
  const [confirm, setConfirm] = useState<null | "ban" | "revoke">(null);
  const [panel, setPanel] = useState<null | "credits" | "badge">(null);

  const [role, setRole] = useState(seller.role);
  const [packId, setPackId] = useState(seller.packs[0]?.id ?? "");
  const [quota, setQuota] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(12);
  const [note, setNote] = useState("");

  const s = seller;
  const badgeLive = Boolean(s.badge?.expiresAt && new Date(s.badge.expiresAt) > new Date());

  const act = (body: Record<string, unknown>, success: string) =>
    run({ url: `/api/admin/vendeurs/${s.id}`, method: "POST", body, success });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <Link
          href={backHref as "/admin/vendeurs"}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2.4} />
          Vendeurs
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
            {s.name}
          </h1>
          {s.bannedAt && <StatusPill tone="bad">Suspendu</StatusPill>}
          {badgeLive && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--gold)]">
              <BadgeCheck className="size-3.5" strokeWidth={2.4} /> Vérifié
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
          <StatusPill status={s.role} />
          {s.phone && <span>{s.phone}</span>}
          {s.governorate && <span>{s.governorate}</span>}
          <span>inscrit le {dt(s.createdAt)}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {s.bannedAt && (
          <p className="border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]">
            <span className="font-semibold">Suspendu le {dt(s.bannedAt)} :</span>{" "}
            {s.bannedReason ?? "sans motif enregistré"}
          </p>
        )}

        <section className="mt-2 border-t border-border pt-4">
          <h2 className={EYEBROW}>Activité</h2>
          <dl className="mt-2">
            <Row label="Annonces">
              <Link
                href={`/admin/annonces?status=all&q=${encodeURIComponent(s.phone ?? "")}` as "/admin/annonces"}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--gold)] hover:underline"
              >
                {s.listings.published} en ligne · {s.listings.total} au total
                <ExternalLink className="size-3" strokeWidth={2.2} />
              </Link>
            </Row>
            <Row label="Paiements">
              {s.payments.captured} validé{s.payments.captured === 1 ? "" : "s"} ·{" "}
              <span className="batta-tabular">{s.payments.amount.toFixed(2)} TND</span>
            </Row>
            <Row label="Publications restantes">
              {s.credits.total > 0 ? (
                <>
                  <span className="batta-tabular">
                    {s.credits.remaining} / {s.credits.total}
                  </span>
                  {s.credits.expiresAt && (
                    <span className="text-subtle"> · expire le {dt(s.credits.expiresAt)}</span>
                  )}
                </>
              ) : (
                <span className="text-subtle">aucun forfait</span>
              )}
            </Row>
            <Row label="Badge vérifié">
              {badgeLive ? `actif jusqu'au ${dt(s.badge!.expiresAt)}` : "aucun"}
            </Row>
          </dl>
        </section>

        <section className="mt-5 border-t border-border pt-4">
          <h2 className={EYEBROW}>Rôle</h2>
          <div className="mt-3 flex items-end gap-2">
            <div className="w-56">
              <SelectField
                label="Type de compte"
                value={role}
                onChange={setRole}
                options={[
                  { value: "individual", label: "Particulier" },
                  { value: "agency", label: "Agence" },
                  { value: "admin", label: "Admin" },
                ]}
              />
            </div>
            <AdminButton
              size="md"
              pending={pending}
              disabled={role === s.role}
              disabledReason="Le rôle n'a pas changé."
              onClick={() => act({ action: "set_role", role }, "Rôle modifié.")}
            >
              Appliquer
            </AdminButton>
          </div>
        </section>

        {panel === "credits" && (
          <section className="mt-5 border-s-2 border-[var(--gold)] ps-4">
            <h2 className={`${EYEBROW} text-[var(--gold)]`}>Créditer un forfait</h2>
            <p className="mt-1.5 text-[11.5px] text-subtle">
              Pour un vendeur qui a payé en espèces, ou une agence que l'on offre. Le geste est
              enregistré à votre nom.
            </p>
            <div className="mt-3 space-y-3.5">
              <SelectField
                label="Forfait"
                value={packId}
                onChange={setPackId}
                options={
                  s.packs.length > 0
                    ? s.packs.map((p) => ({
                        value: p.id,
                        label: `${p.label}${p.quota ? ` · ${p.quota} annonces` : ""}`,
                      }))
                    : [{ value: "", label: "Aucun pack configuré" }]
                }
                hint={
                  s.packs.length === 0
                    ? "Créez d'abord un pack dans Offres & prix."
                    : undefined
                }
              />
              <FieldGrid>
                <NumberField
                  label="Publications"
                  value={quota}
                  onChange={setQuota}
                  min={1}
                  hint="Vide = ce que le forfait accorde."
                />
                <NumberField
                  label="Validité"
                  value={months}
                  onChange={setMonths}
                  min={1}
                  suffix="mois"
                />
              </FieldGrid>
              <TextareaField label="Note interne" value={note} onChange={setNote} rows={2} />
              <div className="flex justify-end gap-2">
                <AdminButton variant="quiet" onClick={() => setPanel(null)}>
                  Annuler
                </AdminButton>
                <AdminButton
                  variant="primary"
                  pending={pending}
                  disabled={!packId}
                  disabledReason="Choisissez un forfait."
                  onClick={async () => {
                    const ok = await act(
                      { action: "grant_credits", product_id: packId, quota, months, note },
                      "Forfait crédité.",
                    );
                    if (ok) setPanel(null);
                  }}
                >
                  Créditer
                </AdminButton>
              </div>
            </div>
          </section>
        )}

        {panel === "badge" && (
          <section className="mt-5 border-s-2 border-[var(--gold)] ps-4">
            <h2 className={`${EYEBROW} text-[var(--gold)]`}>Accorder le badge vérifié</h2>
            <p className="mt-1.5 text-[11.5px] text-subtle">
              Accordé à la main, après vérification. Révocable à tout moment.
            </p>
            <div className="mt-3 space-y-3.5">
              <NumberField
                label="Validité"
                value={months}
                onChange={setMonths}
                min={1}
                suffix="mois"
                hint="12 mois par défaut."
              />
              <TextareaField label="Note interne" value={note} onChange={setNote} rows={2} />
              <div className="flex justify-end gap-2">
                <AdminButton variant="quiet" onClick={() => setPanel(null)}>
                  Annuler
                </AdminButton>
                <AdminButton
                  variant="primary"
                  pending={pending}
                  onClick={async () => {
                    const ok = await act({ action: "grant_badge", months, note }, "Badge accordé.");
                    if (ok) setPanel(null);
                  }}
                >
                  Accorder
                </AdminButton>
              </div>
            </div>
          </section>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        <AdminButton
          icon={<Ticket className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setPanel(panel === "credits" ? null : "credits")}
        >
          Créditer
        </AdminButton>
        {badgeLive ? (
          <AdminButton
            variant="danger"
            icon={<ShieldOff className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("revoke")}
          >
            Retirer le badge
          </AdminButton>
        ) : (
          <AdminButton
            icon={<BadgeCheck className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setPanel(panel === "badge" ? null : "badge")}
          >
            Accorder le badge
          </AdminButton>
        )}

        {s.bannedAt ? (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            pending={pending}
            icon={<RotateCcw className="size-3.5" strokeWidth={2.4} />}
            onClick={() => act({ action: "unban" }, "Compte réactivé.")}
          >
            Réactiver
          </AdminButton>
        ) : (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            icon={<Ban className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("ban")}
          >
            Suspendre
          </AdminButton>
        )}
      </footer>

      <Confirm
        open={confirm === "ban"}
        title="Suspendre ce compte ?"
        body="Le vendeur ne pourra plus publier. Ses annonces en ligne restent visibles jusqu'à ce que vous les archiviez."
        confirmLabel="Suspendre"
        pending={pending}
        reason={{ label: "Motif (interne)", placeholder: "Annonces frauduleuses, impayés…", required: true }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "ban", reason }, "Compte suspendu.")) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "revoke"}
        title="Retirer le badge vérifié ?"
        body="Il disparaît immédiatement de toutes ses annonces."
        confirmLabel="Retirer"
        pending={pending}
        reason={{ label: "Motif (interne)", placeholder: "Vérification caduque, plainte…", required: true }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "revoke_badge", reason }, "Badge retiré.")) setConfirm(null);
        }}
      />
    </div>
  );
}
