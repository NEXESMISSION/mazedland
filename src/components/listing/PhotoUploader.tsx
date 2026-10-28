"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { compressImage } from "@/lib/imageCompress";
import { drawWatermark, loadMark, watermarkImage } from "@/lib/watermark";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { runPool } from "@/lib/pool";
import { useToast } from "@/components/ui/Toast";
import { useSetting } from "@/components/settings/SettingsProvider";
import {
  ArrowLeft, ArrowRight, Camera, CircleAlert, Loader2, RotateCw, Star, Trash2, X,
} from "lucide-react";

/**
 * Photos, uploaded the moment they are picked.
 *
 * TWO THINGS WERE WRONG BEFORE.
 *
 * The uploads hung. `supabase.storage.upload()` goes through supabase-js's auth
 * client, which serialises on the per-ORIGIN Web Lock `lock:sb-<ref>-auth-token`
 * — shared with every other tab on the site. One stalled auth operation
 * anywhere leaves the lock held and every upload queues behind it forever: no
 * HTTP request ever leaves the browser. This repo already hit it once and fixed
 * it for receipts; photos now take the same route — the server mints a signed
 * upload URL and the browser PUTs the bytes with a plain `fetch`. No auth
 * client, no lock, and a real AbortSignal so a stalled send can actually be
 * cancelled and retried.
 *
 * And the feedback lied. While photos were still going up, the step said
 * "Ajoutez au moins une photo" — telling the seller to do the thing they had
 * just done. Each photo now carries its own state (compression, sending,
 * failed) with a retry, the step reports how many are left, and "add a photo"
 * is only ever said when there genuinely are none.
 */

export type UploadedPhoto = { path: string };

type Pending = {
  id: string;
  file: File;
  preview: string;
  phase: "preparing" | "sending" | "failed";
  error?: string;
};

/** A signed upload URL and the path it writes. */
type Target = { path: string; signedUrl: string };

/** The server refused to mint a URL, and said why. */
class MintError extends Error {}

const MAX_PHOTO_MB = 25;

/** Photos prepared and sent at the same time: the CPU encodes one while the network sends another. */
const IN_FLIGHT = 3;

/** Bigger files get longer: a 20 MB photo on 3G is not a stalled one. */
const timeoutFor = (bytes: number) => Math.min(180_000, 30_000 + (bytes / 1e6) * 15_000);

export function PhotoUploader({
  photos,
  onChange,
  onPendingChange,
  disabled = false,
}: {
  photos: UploadedPhoto[];
  /**
   * A setState-style updater, not a plain value. Uploads finish one after
   * another, so appending to the array captured when the batch started would
   * drop every photo but the last.
   */
  onChange: React.Dispatch<React.SetStateAction<UploadedPhoto[]>>;
  /** Lets the step above know uploads are still in flight. */
  onPendingChange?: (pending: number) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const t = useTranslations("photoUploader");
  const tc = useTranslations("common");
  // From /admin/settings. The routes that save the gallery keep only this
  // many, so the picker stops at the same number.
  const max = useSetting("listing_max_photos");
  const watermark = useSetting("feature_watermark");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // One AbortController per photo in flight, so a single photo can be dropped
  // without touching the others. `cancelled` is what tells the rest of the
  // pipeline that an abort was deliberate: the send must not report an error,
  // and the queue must skip a photo cancelled while it was still waiting its
  // turn behind another.
  const controllers = useRef(new Map<string, AbortController>());
  const cancelled = useRef(new Set<string>());

  const cancel = useCallback((id: string) => {
    cancelled.current.add(id);
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setPending((p) => p.filter((x) => x.id !== id));
    URL.revokeObjectURL(id);
  }, []);

  /** Signed upload URLs minted server-side (/api/annonces/photo-url). */
  const mint = useCallback(
    async (exts: string[], signal?: AbortSignal) => {
      const res = await fetch("/api/annonces/photo-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exts }),
        signal,
      });
      if (!res.ok) {
        // The route explains itself ("Trop d'envois de photos…"); that is more
        // use than "Le serveur a refusé l'envoi."
        const j = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new MintError(j.detail ?? t("serverRefused"));
      }
      const { uploads } = (await res.json()) as { uploads?: Target[] };
      return uploads ?? [];
    },
    [t],
  );

  // URLs asked for the whole batch the moment it is picked, so the round trip
  // runs while the first photo is being encoded and no photo waits for its
  // own. Nearly every photo comes out as WebP; the odd one that keeps its
  // original format asks for its own URL. One not used (a cancelled photo)
  // simply expires.
  const reserved = useRef<Target[]>([]);

  /** A photo that landed: its tile goes, the annonce gets the path. */
  const settle = useCallback(
    (id: string, path: string | null) => {
      if (!path) return;
      setPending((p) => p.filter((x) => x.id !== id));
      URL.revokeObjectURL(id);
      onChange((prev) => [...prev, { path }]);
    },
    [onChange],
  );

  // Report the in-flight count from an EFFECT, not from inside the state
  // updater. It used to be done in the `setPending` callback, which React is
  // free to run during render — so telling the parent from there was a
  // setState during another component's render, and React said so:
  //
  //   Cannot update a component (PublishWizard) while rendering a different
  //   component (PhotoUploader)
  //
  // Updater functions have to be pure. This one only computes the next list;
  // the parent hears about it afterwards.
  useEffect(() => {
    onPendingChange?.(pending.filter((x) => x.phase !== "failed").length);
  }, [pending, onPendingChange]);

  const room = max - photos.length - pending.length;

  /**
   * Compress and stamp, take a signed URL, PUT the bytes. Returns the stored
   * path; the caller settles the tile. `reservation` is the batch's URL
   * request, awaited only once the photo is ready to go.
   */
  const send = useCallback(
    async (file: File, tempId: string, reservation: Promise<void> = Promise.resolve()) => {
      const mark = (patch: Partial<Pending>) =>
        setPending((p) => p.map((x) => (x.id === tempId ? { ...x, ...patch } : x)));

      // One controller for the whole send, aborted either by the seller or by
      // a timeout. Built by hand rather than with AbortSignal.any(), which is
      // too new for some of the phones this is used on.
      const ac = new AbortController();
      controllers.current.set(tempId, ac);
      let timedOut = false;
      let timer: number | undefined;
      const arm = (ms: number) => {
        timer = window.setTimeout(() => { timedOut = true; ac.abort(); }, ms);
      };
      const disarm = () => {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
      };
      const done = () => {
        disarm();
        controllers.current.delete(tempId);
        cancelled.current.delete(tempId);
      };

      // One decode, one encode: the gold logo is drawn on the scaled photo
      // right before it is encoded (`decorate`). It used to be stamped in a
      // second pass that decoded the WebP again and re-encoded it at 0.92 —
      // twice the CPU on the phone and a bigger file to send, for nothing.
      // `compressImage` returns the input untouched on a few paths (an
      // already-small modern format, an input over its byte ceiling, a
      // re-encode that grew): those are stamped on their own, as before.
      // Switched off in /admin/settings, new photos go up clean; those
      // already sent keep theirs.
      const stamp = watermark ? await loadMark() : null;
      let out = file;
      try {
        out = await compressImage(file, {
          maxEdge: 1600,
          quality: 0.8,
          format: "webp",
          decorate: stamp ? (ctx, w, h) => drawWatermark(ctx, stamp, w, h) : undefined,
        });
      } catch {
        out = file; // compression is an optimisation, not a gate
      }
      if (watermark && out === file) out = await watermarkImage(out);

      mark({ phase: "sending" });

      const ext = out.name.split(".").pop()?.toLowerCase() || "webp";
      try {
        await reservation;
        let target: Target | undefined = ext === "webp" ? reserved.current.shift() : undefined;
        if (!target) {
          arm(20_000);
          target = (await mint([ext], ac.signal))[0];
          disarm();
        }
        if (!target) {
          mark({ phase: "failed", error: t("unexpectedResponse") });
          return null;
        }

        // Multipart with an empty field name is what the storage API expects
        // for a signed upload (see storage-js uploadToSignedUrl).
        const form = new FormData();
        // A year, immutable. The server mints a unique path per upload
        // (user id + timestamp + random + index), so a stored object is never
        // replaced — an edit produces a new path. One hour meant Supabase's CDN
        // dropped it hourly, and every next/image variant that expired then had
        // to go back to origin for the source before it could transcode. That
        // origin round trip is the slow, sometimes-failing part of the whole
        // pipeline; this removes it for everything we host ourselves.
        form.append("cacheControl", "31536000");
        form.append("", out);

        arm(timeoutFor(out.size));
        const put = await fetch(target.signedUrl, {
          method: "PUT",
          body: form,
          signal: ac.signal,
        });
        disarm();
        if (!put.ok) {
          mark({ phase: "failed", error: t("putRefused", { status: put.status }) });
          return null;
        }

        // Cancelled after the bytes landed: the seller asked for it gone, so
        // it does not join the annonce even though the upload succeeded.
        if (cancelled.current.has(tempId)) return null;
        return target.path;
      } catch (e) {
        // A deliberate cancel is not a failure — the tile is already gone.
        if (cancelled.current.has(tempId)) return null;
        mark({
          phase: "failed",
          error: e instanceof MintError ? e.message : timedOut ? t("tooSlow") : t("sendFailed"),
        });
        return null;
      } finally {
        done();
      }
    },
    [t, watermark, mint],
  );

  const accept = useCallback(
    async (files: File[]) => {
      if (disabled) return;
      // Some pickers hand over HEIC/HEIF from an iPhone with an empty MIME
      // type, and those files were dropped without a word.
      const looksLikeImage = (f: File) =>
        f.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp|avif|gif)$/i.test(f.name);
      const images = files.filter(looksLikeImage);
      const rejected = files.filter((f) => !looksLikeImage(f));
      if (rejected.length > 0) {
        toast(t("filesIgnored", { count: rejected.length }), "warning");
      }
      if (images.length === 0) return;
      if (room <= 0) {
        toast(t("maxPhotos", { max }), "warning");
        return;
      }

      const batch = images.slice(0, room);
      for (const f of batch.filter((f) => f.size > MAX_PHOTO_MB * 1024 * 1024)) {
        toast(t("tooBig", { name: f.name, mb: MAX_PHOTO_MB }), "error");
      }
      const ok = batch.filter((f) => f.size <= MAX_PHOTO_MB * 1024 * 1024);
      if (ok.length === 0) return;

      // Local previews first: the seller sees their photos in the grid before
      // the network has done anything at all.
      const marks: Pending[] = ok.map((f) => {
        const url = URL.createObjectURL(f);
        return { id: url, file: f, preview: url, phase: "preparing" as const };
      });
      setPending((p) => [...p, ...marks]);

      // The batch's upload URLs, asked for now — the round trip runs under
      // the first photo's encoding. A refusal is not reported here: each
      // photo then asks for its own URL and hears the reason.
      const reservation = mint(ok.map(() => "webp")).then(
        (urls) => { reserved.current.push(...urls); },
        () => {},
      );

      // A few at a time (IN_FLIGHT): one photo encodes while another sends.
      // All at once, a phone pushing six photos on 3G finished them all late
      // instead of the first one early; one at a time left the network idle
      // while the CPU worked and the CPU idle while the network sent. The
      // photos join the annonce in the order they were picked, whatever
      // order they land in — the first one is the cover.
      const landed: (string | null | undefined)[] = marks.map(() => undefined);
      let flushed = 0;
      const flush = () => {
        while (flushed < marks.length && landed[flushed] !== undefined) {
          settle(marks[flushed].id, landed[flushed] ?? null);
          flushed++;
        }
      };
      await runPool(marks, IN_FLIGHT, async (m, i) => {
        // Cancelled while it was still queued behind another photo: never send
        // it at all.
        landed[i] = cancelled.current.delete(m.id) ? null : await send(m.file, m.id, reservation);
        flush();
      });
    },
    [disabled, room, max, toast, send, settle, mint, t],
  );

  function retry(id: string) {
    const item = pending.find((p) => p.id === id);
    if (!item) return;
    setPending((p) =>
      p.map((x) => (x.id === id ? { ...x, phase: "preparing", error: undefined } : x)),
    );
    void (async () => {
      settle(item.id, await send(item.file, item.id));
    })();
  }

  /**
   * Promote a photo to the front, which is what "couverture" means: the
   * annonce shows photos in order and the first one is the cover.
   *
   * It has its own control because the alternative was tapping the left arrow
   * once per position — five taps to promote the sixth photo, with a re-render
   * between each. Nobody found that, so nobody changed their cover.
   */
  function makeCover(from: number) {
    onChange((prev) => {
      if (from <= 0 || from >= prev.length) return prev;
      const next = prev.slice();
      const [x] = next.splice(from, 1);
      next.unshift(x);
      return next;
    });
  }

  function move(from: number, to: number) {
    onChange((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  }

  const sending = pending.filter((p) => p.phase !== "failed").length;
  const failed = pending.filter((p) => p.phase === "failed").length;

  return (
    <div>
      <button
        type="button"
        disabled={disabled || room <= 0}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void accept(Array.from(e.dataTransfer.files));
        }}
        className={
          "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 transition " +
          (dragOver
            ? "border-gold bg-gold-faint"
            : "border-border bg-surface-2/40 hover:border-gold-soft") +
          (disabled || room <= 0 ? " cursor-not-allowed opacity-50" : "")
        }
      >
        <span className="grid size-11 place-items-center rounded-full bg-gold-faint text-gold">
          <Camera className="size-5" />
        </span>
        <span className="text-[13.5px] font-bold text-foreground">
          {photos.length === 0 ? t("addPhotos") : t("addMorePhotos")}
        </span>
        <span className="text-[11.5px] text-muted">
          {room > 0 ? t("limitRoom", { max, room }) : t("limitReached", { max })}
        </span>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void accept(files);
        }}
      />

      {/* What is happening right now — said once, above the grid. */}
      {sending > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gold-faint px-3 py-2 text-[12.5px] font-semibold text-gold ring-1 ring-gold-soft">
          <Loader2 className="size-3.5 animate-spin" />
          {t("sendingCount", { count: sending })}
        </p>
      )}
      {sending === 0 && failed > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--accent-faint)] px-3 py-2 text-[12.5px] font-semibold text-[var(--accent-deep)]">
          <CircleAlert className="size-3.5" />
          {t("failedCount", { count: failed })}
        </p>
      )}
      {sending === 0 && failed === 0 && photos.length > 0 && (
        <p className="mt-3 text-[11.5px] text-muted">
          {t("sentCount", { count: photos.length })}
        </p>
      )}

      {photos.length > 1 && (
        <p className="mt-2 text-[11.5px] text-muted">
          {t("reorderHint")}
        </p>
      )}

      {/* Two across on a phone, not three. The controls below live on the
          tile, and four of them across a 105px square is a row of targets too
          small and too close to hit. */}
      {(photos.length > 0 || pending.length > 0) && (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <li
              key={p.path}
              className="group relative aspect-square overflow-hidden rounded-xl bg-black ring-1 ring-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={propertyPhotoUrl(p.path)} alt="" className="size-full object-contain" />

              {i === 0 && (
                <span className="absolute inset-x-1 top-1 inline-flex items-center justify-center gap-1 rounded-md bg-[var(--gold)] py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[var(--background)]">
                  <Star className="size-2.5" /> {t("cover")}
                </span>
              )}

              {/* ALWAYS VISIBLE on a touch screen.

                  This bar was `opacity-0 group-hover:opacity-100`. A phone has
                  no hover, so on a phone the controls did not exist: the photos
                  could not be reordered, could not be deleted, and the cover
                  could not be changed. It only ever worked on a desktop, where
                  the mouse revealed it by accident.

                  So: shown by default, and only hidden-until-hover from lg,
                  where a mouse is doing the pointing and a permanently dark bar
                  across every thumbnail would be noise. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-black/75 p-1 transition lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={t("moveBefore")}
                  className="tap-target rounded p-1.5 text-white disabled:opacity-25"
                >
                  {/* "Before" is toward the start of the grid: the right in Arabic. */}
                  <ArrowLeft className="size-4 rtl:-scale-x-100" />
                </button>
                <button
                  type="button"
                  onClick={() => makeCover(i)}
                  disabled={i === 0}
                  aria-label={t("makeCover")}
                  title={t("cover")}
                  className="tap-target rounded p-1.5 text-white disabled:opacity-25"
                >
                  <Star className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("deletePhoto")}
                  className="tap-target rounded p-1.5 text-white"
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === photos.length - 1}
                  aria-label={t("moveAfter")}
                  className="tap-target rounded p-1.5 text-white disabled:opacity-25"
                >
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </button>
              </div>
            </li>
          ))}

          {pending.map((p) => (
            <li
              key={p.id}
              className={
                "relative aspect-square overflow-hidden rounded-xl bg-black ring-1 " +
                (p.phase === "failed" ? "ring-[var(--accent-deep)]" : "ring-border")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="size-full object-contain opacity-35" />

              {p.phase === "failed" ? (
                <div className="absolute inset-0 grid place-items-center gap-1 p-1 text-center">
                  <button
                    type="button"
                    onClick={() => retry(p.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--gold)] px-2 py-1 text-[10px] font-extrabold text-[var(--background)]"
                  >
                    <RotateCw className="size-3" /> {t("retry")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPending((s) => s.filter((x) => x.id !== p.id));
                      URL.revokeObjectURL(p.id);
                    }}
                    className="text-[9.5px] font-bold text-white/70 underline"
                  >
                    {t("remove")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 grid place-items-center gap-1">
                    <Loader2 className="size-5 animate-spin text-gold" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/80">
                      {p.phase === "preparing" ? t("preparing") : t("sending")}
                    </span>
                  </div>
                  {/* Waiting for an upload you no longer want is not a state
                      anyone should be stuck in. This aborts the request. */}
                  <button
                    type="button"
                    onClick={() => cancel(p.id)}
                    aria-label={t("cancelUpload")}
                    title={tc("cancel")}
                    className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-black/75 text-white ring-1 ring-white/25 transition hover:bg-[var(--accent-deep)]"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
