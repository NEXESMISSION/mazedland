"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import { uploadToBucket } from "@/lib/upload";
import { compressImage, type CompressOptions } from "@/lib/imageCompress";

const TAG = "[NativeCapture]";
function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(
    `%c${TAG} %c${ts}`,
    "color:#d4af37;font-weight:bold",
    "color:#888",
    ...args,
  );
}
function err(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(
    `%c${TAG} %c${ts}`,
    "color:#ef4444;font-weight:bold",
    "color:#888",
    ...args,
  );
}

interface BaseProps {
  /** "photo" → image/* | "video" → video/*. */
  kind: "photo" | "video";
  /** Front- or back-facing camera. Hint to the OS picker. */
  facing?: "user" | "environment";
  /** Sub-folder under the user's bucket (e.g. "kyc", "properties"). */
  folder: string;
  /** Called with the storage url/path once the file is uploaded. For
   *  private buckets (kyc, etc.) this is the storage path — useless as
   *  `<img src>`. Use `onPreview` for display. */
  onCaptured: (url: string) => void;
  /** Optional — fires synchronously the moment the user picks a file,
   *  with a local `URL.createObjectURL` blob URL. Renders the preview
   *  instantly without waiting for compression + upload. The caller is
   *  responsible for revoking the URL on unmount or replacement. */
  onPreview?: (previewUrl: string) => void;
  /** Optional override for the visible button label. */
  label?: string;
  /** Disable the trigger (during another in-flight action). */
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
  /** Render-prop alternative — when provided we don't render a button,
   *  the consumer renders whatever it wants and calls `open()`. */
  children?: (state: { open: () => void; uploading: boolean }) => React.ReactNode;
  /** Per-call image compression overrides. KYC docs pass higher quality
   *  so OCR text stays crisp; default preset is fine for property
   *  photos. Ignored for `kind === "video"`. */
  compress?: CompressOptions;
  /** Optional pre-upload validation. Runs on the raw picked File before
   *  compression / upload. Return `{ ok: false, reason }` to abort. */
  validate?: (file: File) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

// Per-folder compression presets. Two principles:
//  - Photos (property listings) → AVIF. ~20–30 % smaller than WebP at
//    the same perceptual quality, big on cold listing-page loads. We
//    keep `format: "auto"` so Firefox / older Safari fall back to WebP
//    automatically (with the quality re-mapped inside compressImage).
//  - Documents / IDs / credentials → WebP. AVIF's block transform is
//    rougher on small text and the admin review queue needs the CIN
//    digits and credential names to stay crisp.
//
// KYC sizing rationale: a Tunisian CIN is 85×54 mm. 1600 px on the
// long edge gives ~19 px/mm — well above the 12 px/mm threshold OCR
// engines and human reviewers need for the printed digits to read
// cleanly. Going larger (the old 2000 px) just shipped padding bytes.
const PRESETS: Record<string, CompressOptions> = {
  properties: { maxEdge: 1600, quality: 0.62, format: "auto" },
  kyc: { maxEdge: 1600, quality: 0.82, format: "webp" },
  "property-documents": { maxEdge: 1800, quality: 0.84, format: "webp" },
  "inspector-credentials": { maxEdge: 1600, quality: 0.82, format: "webp" },
  "inspection-reports": { maxEdge: 1800, quality: 0.84, format: "webp" },
  default: { maxEdge: 1600, quality: 0.62, format: "auto" },
};

/**
 * One-shot native capture. Tapping the trigger opens the device's OS
 * camera (the input element's `capture` attribute drives this on iOS and
 * Android). The user snaps and confirms inside the OS UI — no in-app
 * preview or extra "validate" button. The picked file is uploaded to
 * Supabase Storage and the public URL flows back via onCaptured.
 *
 * On desktop, the same input opens the platform's file picker — useful
 * for testing without a webcam.
 */
export function NativeCapture({
  kind,
  facing = "environment",
  folder,
  onCaptured,
  onPreview,
  label,
  disabled,
  className,
  children,
  compress,
  validate,
}: BaseProps) {
  const { user, loaded: authLoaded } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function open() {
    log("open()", { folder, kind, facing, disabled, uploading, hasUser: Boolean(user), authLoaded });
    if (uploading || disabled) return;
    // Auth is per-hook-instance and re-fetches on mount, so right after a
    // navigation `user` can be null for a few hundred ms before the
    // getUser() resolves. Don't surface a "log in" toast during that
    // window — silently no-op; the button is visually disabled below.
    if (!authLoaded) {
      log("open() ignored — auth still loading");
      return;
    }
    if (!user) {
      err("open() blocked — no user in context");
      toast("Connectez-vous d'abord", "warning");
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
      log("native input click dispatched");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    log("onFile", {
      hasFile: Boolean(f),
      name: f?.name,
      type: f?.type,
      size: f?.size,
      lastModified: f?.lastModified,
    });
    if (!f || !user) return;
    if (validate) {
      const v = await validate(f);
      if (!v.ok) {
        log("validate rejected", { reason: v.reason });
        toast(v.reason, "warning");
        return;
      }
    }
    // Synchronous preview — fires the blob URL before compression so the
    // UI can render the photo INSTANTLY while compress + upload run in
    // the background. Critical for private buckets (kyc) where the
    // storage path isn't a usable `<img src>`.
    if (kind === "photo" && onPreview) {
      try {
        const previewUrl = URL.createObjectURL(f);
        log("preview blob url emitted", { previewUrl });
        onPreview(previewUrl);
      } catch (e) {
        log("preview blob url failed (non-fatal)", e);
      }
    }
    setUploading(true);
    const t0 = performance.now();
    try {
      let payload: File = f;
      if (kind === "photo" && f.type.startsWith("image/")) {
        const preset = compress ?? PRESETS[folder] ?? PRESETS.default;
        payload = await compressImage(f, preset);
        log("post-compress payload", {
          origKB: Math.round(f.size / 1024),
          newKB: Math.round(payload.size / 1024),
          preset,
        });
      }
      log("uploadToBucket → start", { folder, userId: user.id });
      const { url, path } = await uploadToBucket(payload, user.id, folder);
      const ms = Math.round(performance.now() - t0);
      log("uploadToBucket → done", { ms, url, path });
      onCaptured(url);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      err("uploadToBucket failed", { ms, error: e, message: msg });
      toast("Échec du téléversement : " + msg, "error");
    } finally {
      setUploading(false);
    }
  }

  const Icon = kind === "video" ? Video : Camera;
  const fallbackLabel = kind === "video" ? "Filmer" : "Prendre la photo";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={kind === "video" ? "video/*" : "image/*"}
        capture={facing}
        onChange={onFile}
        className="hidden"
      />
      {children ? (
        // eslint-disable-next-line react-hooks/refs
        children({ open, uploading })
      ) : (
        <Button
          size="xl"
          fullWidth
          onClick={open}
          disabled={disabled || uploading || !authLoaded}
          className={className}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
          {uploading ? "Téléversement…" : label ?? fallbackLabel}
        </Button>
      )}
    </>
  );
}
