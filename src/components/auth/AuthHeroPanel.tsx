import { ShieldCheck, Eye, Zap, Star } from "lucide-react";

/**
 * Desktop-only split-screen hero for the auth pages. A full-height
 * property photo under a deep-navy scrim, with the brand promise, three
 * trust points, and a slim social-proof line set directly on the image
 * (no stacked cards) — kept compact so the whole auth screen fits in one
 * viewport without scrolling. Rendered only inside the `hidden lg:grid`
 * tree, so phones never load it.
 */
const FEATURES = [
  { Icon: ShieldCheck, title: "100% sécurisé",    sub: "Transactions vérifiées" },
  { Icon: Eye,         title: "Transparence totale", sub: "Informations vérifiées" },
  { Icon: Zap,         title: "Simple et rapide",  sub: "Enchérissez en quelques clics" },
];

export function AuthHeroPanel() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d1b3d]">
      <picture>
        <source srcSet="/auth-hero.avif" type="image/avif" />
        <source srcSet="/auth-hero.webp" type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auth-hero.webp"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
      {/* Deep scrim so white text + icons read on any photo. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a1530]/95 via-[#0a1530]/55 to-[#0a1530]/35" />

      <div className="relative flex h-full flex-col justify-between p-12">
        {/* Top — one brand pill */}
        <span className="inline-flex w-fit items-center gap-2.5 rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-bold text-white ring-1 ring-white/20 backdrop-blur">
          <ShieldCheck className="size-4 shrink-0" strokeWidth={2} />
          La maison des enchères immobilières tunisiennes
        </span>

        {/* Bottom — headline + trust points + social proof */}
        <div>
          <h2 className="max-w-md text-balance text-[32px] font-extrabold leading-[1.12] tracking-tight text-white">
            Achetez et vendez en toute confiance.
          </h2>

          <div className="mt-7 space-y-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-center gap-3.5 text-white">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
                  <f.Icon className="size-5" strokeWidth={2} />
                </span>
                <div>
                  <div className="text-[14px] font-bold leading-tight">{f.title}</div>
                  <div className="text-[12px] text-white/65">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <div className="flex -space-x-2.5">
              {["#3b82f6", "#6366f1", "#0ea5e9", "#8b5cf6"].map((c, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="size-8 rounded-full ring-2 ring-[#0d1b3d]"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="leading-tight text-white">
              <div className="text-[12.5px] font-extrabold">Plus de 12 000 utilisateurs</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-3 fill-amber-400 text-amber-400" strokeWidth={0} />
                  ))}
                </span>
                <span className="text-[11px] text-white/60">nous font confiance</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
