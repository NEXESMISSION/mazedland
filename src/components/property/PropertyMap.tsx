import { MapPin, ExternalLink } from "lucide-react";

/**
 * Inline map for the property detail. Uses OpenStreetMap's standard
 * embed iframe (zero JS, free, no API key) framed by a small bbox
 * around the property's lat/lng. CSP allows the iframe via
 * `frame-src https://www.openstreetmap.org` (see next.config.ts).
 *
 * Below the map, we surface deep-links into the user's preferred maps
 * app:
 *   - geo:LAT,LNG       → Android default handler
 *   - maps://?q=LAT,LNG → iOS / macOS Apple Maps
 *   - openstreetmap.org/?mlat=...&mlon=... → desktop fallback
 *
 * Without lat/lng we render nothing — the address text upstream of
 * this card already tells the user where the property is.
 */
export function PropertyMap({
  lat,
  lng,
  address,
}: {
  lat: number;
  lng: number;
  address?: string | null;
}) {
  // ~600m bounding box at typical Tunisian latitudes. OSM picks a sensible
  // zoom level from the bbox so we don't have to pass one explicitly.
  const span = 0.005;
  const bbox = [lng - span, lat - span, lng + span, lat + span].join(",");
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const geoLink = `geo:${lat},${lng}?q=${encodeURIComponent(address ?? `${lat},${lng}`)}`;

  return (
    <section className="batta-frame mx-4 mt-4 overflow-hidden">
      <iframe
        title="Property location"
        src={embedUrl}
        loading="lazy"
        className="aspect-[16/10] w-full border-0"
        referrerPolicy="no-referrer"
      />
      <div className="flex items-center gap-3 border-t border-black/[0.07] bg-white px-3.5 py-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted">
          <MapPin className="size-3.5 shrink-0 text-gold" strokeWidth={2} />
          <span className="truncate">
            {address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
          </span>
        </span>
        <a
          href={geoLink}
          className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--gold-faint)] px-3.5 py-1.5 text-[11px] font-bold text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-white"
        >
          <ExternalLink className="size-3" strokeWidth={2.4} />
          Ouvrir le plan
        </a>
      </div>
    </section>
  );
}
