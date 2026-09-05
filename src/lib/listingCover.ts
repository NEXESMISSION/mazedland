/**
 * Which photo represents an annonce.
 *
 * It used to be `photos[0]` by sort_order — the seller's first upload, which
 * on the imported catalogue is usually the dashboard shot. That is why a
 * brake-pad advert led with an odometer.
 *
 * Now: the photo an admin marked as the cover (0171), and only failing that
 * the first one. One helper, so the home hero, the catalogue cards and the
 * listing page can never disagree about which image is the annonce.
 */
export type CoverPhoto = {
  storage_path: string;
  sort_order: number;
  is_cover?: boolean | null;
};

export function coverPhoto<T extends CoverPhoto>(photos: T[] | null | undefined): T | null {
  if (!photos || photos.length === 0) return null;
  return (
    photos.find((p) => p.is_cover === true) ??
    photos.slice().sort((a, b) => a.sort_order - b.sort_order)[0] ??
    null
  );
}

/** Convenience for the many call sites that only want the path. */
export function coverPath(photos: CoverPhoto[] | null | undefined): string | null {
  return coverPhoto(photos)?.storage_path ?? null;
}
