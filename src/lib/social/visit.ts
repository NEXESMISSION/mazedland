"use client";

/**
 * The browser half of the post tracking: the annonce page remembers, for the
 * session, that the visitor came from a post (the UTM tags in its address),
 * and says so once — on the visit, and on the first « afficher le numéro ».
 * The server half is /api/social/track.
 */
type Attribution = { utm_source: string; utm_medium: string; utm_campaign: string };

const key = (listingId: string) => `mz-social:${listingId}`;

function read(listingId: string): (Attribution & { sent: string[] }) | null {
  try {
    const raw = sessionStorage.getItem(key(listingId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function send(listingId: string, a: Attribution, event: "visit" | "contact") {
  const saved = read(listingId);
  const sent = saved?.sent ?? [];
  if (sent.includes(event)) return;
  try {
    sessionStorage.setItem(key(listingId), JSON.stringify({ ...a, sent: [...sent, event] }));
  } catch {
    // Private mode: the server's own per-session hash still counts it once.
  }
  void fetch("/api/social/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listingId, event, ...a }),
    keepalive: true,
  }).catch(() => {});
}

/** On the annonce page: a visit from a post, if the address says so. */
export function recordSocialVisit(listingId: string, search: string) {
  const q = new URLSearchParams(search);
  if (q.get("utm_medium") !== "social" || !q.get("utm_campaign")?.startsWith("mz-")) return;
  send(listingId, {
    utm_source: q.get("utm_source") ?? "",
    utm_medium: "social",
    utm_campaign: q.get("utm_campaign") ?? "",
  }, "visit");
}

/** When the visitor asks for the number: a contact, if the visit came from a post. */
export function recordSocialContact(listingId: string) {
  const saved = read(listingId);
  if (saved) send(listingId, saved, "contact");
}
