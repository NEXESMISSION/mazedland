"use client";

import { getBrowserSupabase } from "@/lib/supabase/client";

const TAG = "[upload]";
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

export interface UploadResult {
  url: string;
  path: string;
}

/**
 * Folder → bucket mapping. Each folder name corresponds to a specific
 * Supabase storage bucket with its own RLS policy:
 *   - "kyc"                   → kyc bucket (private; owner+admin read)
 *   - "properties"            → properties bucket (public read; photos)
 *   - "property-documents"    → property-documents bucket (KYC+deposit gated)
 *   - "inspector-credentials" → inspector-credentials bucket (private)
 */
const FOLDER_TO_BUCKET: Record<string, string> = {
  kyc: "kyc",
  properties: "properties",
  "property-documents": "property-documents",
  "inspector-credentials": "inspector-credentials",
};

// ─── Validation policy ─────────────────────────────────────────────────────
// Storage RLS scopes writes to the caller's own folder, but doesn't validate
// MIME / size / extension. Those checks live here so users see a friendly
// error before bytes leave the browser.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_DOC_BYTES = 12 * 1024 * 1024; // 12 MB (PDFs for titre foncier etc.)

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const ALLOWED_DOC_MIME = new Set(["application/pdf"]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export class UploadValidationError extends Error {
  constructor(
    message: string,
    public readonly code: "MIME_NOT_ALLOWED" | "FILE_TOO_LARGE" | "EMPTY_FILE" | "UNKNOWN_FOLDER",
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

function validateFile(file: File): { ext: string; contentType: string } {
  if (!file.size || file.size <= 0) {
    throw new UploadValidationError("Le fichier est vide.", "EMPTY_FILE");
  }
  const mime = (file.type || "").toLowerCase();
  if (ALLOWED_IMAGE_MIME.has(mime)) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new UploadValidationError(
        `Image trop volumineuse (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`,
        "FILE_TOO_LARGE",
      );
    }
    return { ext: MIME_TO_EXT[mime] ?? "jpg", contentType: mime };
  }
  if (ALLOWED_VIDEO_MIME.has(mime)) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new UploadValidationError(
        `Vidéo trop volumineuse (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB).`,
        "FILE_TOO_LARGE",
      );
    }
    return { ext: MIME_TO_EXT[mime] ?? "mp4", contentType: mime };
  }
  if (ALLOWED_DOC_MIME.has(mime)) {
    if (file.size > MAX_DOC_BYTES) {
      throw new UploadValidationError(
        `Document trop volumineux (max ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} MB).`,
        "FILE_TOO_LARGE",
      );
    }
    return { ext: MIME_TO_EXT[mime] ?? "pdf", contentType: mime };
  }
  throw new UploadValidationError(
    `Format non supporté (${mime || "inconnu"}). Formats acceptés: JPG, PNG, WebP, HEIC, MP4, MOV, WebM, PDF.`,
    "MIME_NOT_ALLOWED",
  );
}

/**
 * Uploads a file to the Supabase bucket associated with `folder`, inside
 * the user's folder. RLS guarantees only the user can write to their own
 * folder. Caller picks the folder name from the `FOLDER_TO_BUCKET` map
 * keys.
 *
 * Path layout: `<userId>/<timestamp>-<rand>.<ext>` for KYC,
 * `<userId>/<propertyId>/<filename>` style is up to the property flow.
 *
 * Throws `UploadValidationError` for client-side validation failures
 * (unsupported MIME, oversize, unknown folder).
 */
export async function uploadToBucket(
  file: File,
  userId: string,
  folder: string,
): Promise<UploadResult> {
  const bucket = FOLDER_TO_BUCKET[folder];
  if (!bucket) {
    throw new UploadValidationError(
      `Unknown upload folder: ${folder}`,
      "UNKNOWN_FOLDER",
    );
  }

  const { ext, contentType } = validateFile(file);
  const supabase = getBrowserSupabase();

  // Server-generated filename only — never `file.name`. The user has no
  // input into the path beyond their own user id (enforced by RLS) and
  // the folder string (an internal enum passed by the caller).
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${Date.now()}-${rand}.${ext}`;

  log("upload start", {
    bucket,
    path,
    contentType,
    sizeBytes: file.size,
    mime: file.type,
  });

  const t0 = performance.now();
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType, upsert: false });
  const ms = Math.round(performance.now() - t0);

  if (error) {
    err("upload failed", { ms, path, error });
    throw error;
  }
  log("upload done", { ms, data });

  // Private buckets (kyc, property-documents, inspector-credentials)
  // don't have public URLs — getPublicUrl returns the URL format but
  // the object 401s on download. Callers store the path and request
  // a signed URL when they actually need to render the file.
  if (bucket === "properties") {
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    log("publicUrl", pub.publicUrl);
    return { url: pub.publicUrl, path };
  }
  // For private buckets, return the path as the "url" so the caller can
  // store it. Downstream code calls `createSignedUrl(path, ttl)` to render.
  return { url: path, path };
}
