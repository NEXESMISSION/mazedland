"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Heart, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Save an annonce.
 *
 * Optimistic: the heart fills on the tap and rolls back if the write fails.
 * A favourite is a low-stakes, high-frequency action — waiting on a round-trip
 * to colour an icon makes the whole catalog feel slow, and the failure case is
 * a heart that un-fills, not lost money.
 *
 * A logged-out visitor is sent to sign in with `next` pointing back here, so
 * they land on the annonce they were saving rather than the home page.
 */
export function FavoriteButton({
  listingId,
  initialSaved,
  loggedIn,
  size = "md",
  className,
}: {
  listingId: string;
  initialSaved: boolean;
  loggedIn: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // These sit inside listing cards, which are links.
    e.preventDefault();
    e.stopPropagation();

    if (!loggedIn) {
      router.push(
        `/login?next=${encodeURIComponent(`/annonces/${listingId}`)}` as never,
      );
      return;
    }

    const next = !saved;
    setSaved(next);
    setBusy(true);

    const send = () =>
      fetch(`/api/annonces/${listingId}/favorite`, {
        method: next ? "POST" : "DELETE",
      });

    try {
      let res = await send();

      // The route has to ask Supabase who you are, and that is a network call.
      // When it times out the route answers 500 and the heart used to just
      // un-fill with "impossible d'enregistrer" — which reads as "this feature
      // is broken" for what is usually a one-second blip. One retry catches it.
      if (!res.ok && res.status >= 500) {
        await new Promise((r) => setTimeout(r, 700));
        res = await send();
      }

      if (!res.ok) {
        setSaved(!next);
        // 401 is a different problem from a failed write, and telling someone
        // their favourite could not be saved when the real answer is "your
        // session ended" sends them looking in the wrong place.
        toast(
          res.status === 401
            ? "Votre session a expiré. Reconnectez-vous pour enregistrer vos favoris."
            : "Impossible d'enregistrer ce favori. Réessayez.",
          res.status === 401 ? "warning" : "error",
        );
      }
    } catch {
      setSaved(!next);
      toast("Pas de connexion. Réessayez.", "error");
    } finally {
      setBusy(false);
    }
  }

  const px = size === "sm" ? "size-8" : "size-10";
  const icon = size === "sm" ? "size-4" : "size-[18px]";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? "Retirer des favoris" : "Ajouter aux favoris"}
      className={cn(
        "inline-flex items-center justify-center rounded-full border backdrop-blur-md transition",
        px,
        saved
          ? "border-[var(--gold-soft)] bg-[var(--gold-faint)] text-[var(--gold)]"
          : "border-white/20 bg-black/45 text-white hover:bg-black/65",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn(icon, "animate-spin")} />
      ) : (
        <Heart className={icon} strokeWidth={2.2} fill={saved ? "currentColor" : "none"} />
      )}
    </button>
  );
}
