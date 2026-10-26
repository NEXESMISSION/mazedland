import type { SocialChannel } from "@/lib/social/channels";

/**
 * A social post as it will read: the Facebook page's card, the Instagram
 * square with its caption, or the plain text prepared for the groups. Each
 * line takes its own direction, since a post in both languages mixes them.
 * Used by the seller's promotion page and the console's review.
 */
export function PostPreview({
  channel,
  body,
  photos,
  label,
}: {
  channel: SocialChannel;
  body: string;
  photos: string[];
  label: string;
}) {
  const lines = body.split("\n");
  const text = (
    <div className="space-y-0.5 text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {lines.map((line, i) => (line.trim() ? <p key={i} dir="auto">{line}</p> : <div key={i} className="h-2" />))}
    </div>
  );
  const head = (
    <div className="flex items-center gap-2 px-3 pt-3">
      <span className="grid size-8 place-items-center rounded-full bg-foreground text-[12px] font-black text-[var(--background)]">M</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-bold text-foreground">Mazed Immo</span>
        <span className="block text-[11px] text-muted">{label}</span>
      </span>
    </div>
  );

  if (channel === "instagram") {
    return (
      <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface">
        {head}
        <div className="mt-3 aspect-[4/5] w-full bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a preview of a remote post, not a page image */}
          {photos[0] && <img src={photos[0]} alt="" className="size-full object-cover" />}
        </div>
        {photos.length > 1 && (
          <div className="flex justify-center gap-1 py-2">
            {photos.map((_, i) => (
              <span key={i} className={`size-1.5 rounded-full ${i === 0 ? "bg-gold" : "bg-border"}`} />
            ))}
          </div>
        )}
        <div className="p-3 pt-1">{text}</div>
      </article>
    );
  }

  if (channel === "facebook_groups") {
    return (
      <article className="min-w-0 rounded-2xl border border-dashed border-border bg-surface-2/40 p-3">
        <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted">{label}</p>
        {text}
      </article>
    );
  }

  const grid = photos.slice(0, 4);
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface">
      {head}
      <div className="px-3 py-3">{text}</div>
      {grid.length > 0 && (
        <div className={`grid gap-0.5 ${grid.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {grid.map((src, i) => (
            <div key={src} className={`bg-surface-2 ${grid.length === 3 && i === 0 ? "col-span-2 aspect-[2/1]" : grid.length === 1 ? "aspect-[4/3]" : "aspect-square"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a preview of a remote post, not a page image */}
              <img src={src} alt="" className="size-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
