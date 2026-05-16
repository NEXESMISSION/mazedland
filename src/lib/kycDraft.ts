"use client";

// sessionStorage-backed draft for the multi-step KYC flow. Each step
// captures one piece (CIN front / back / selfie video + still) and
// saves the resulting storage path here; the processing step picks
// them all up to insert a single kyc_submissions row.

const KEY = "batta_kyc_draft";
const TAG = "[KYC/draft]";

function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(
    `%c${TAG} %c${ts}`,
    "color:#d4af37;font-weight:bold",
    "color:#888",
    ...args,
  );
}

export interface KycDraft {
  /** Storage path of the CIN front photo. */
  idFrontUrl?: string;
  /** Storage path of the CIN back photo. */
  idBackUrl?: string;
  /** Storage path of the liveness selfie video (recorded by LivenessCheck). */
  selfieVideoUrl?: string;
  /** Storage path of the captured still frame from the selfie video. */
  selfieImageUrl?: string;
}

export function readKycDraft(): KycDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    const draft = raw ? (JSON.parse(raw) as KycDraft) : {};
    log("read", draft);
    return draft;
  } catch (e) {
    log("read failed", e);
    return {};
  }
}

export function updateKycDraft(patch: Partial<KycDraft>) {
  if (typeof window === "undefined") return;
  const next = { ...readKycDraft(), ...patch };
  log("update", { patch, next });
  sessionStorage.setItem(KEY, JSON.stringify(next));
}

export function clearKycDraft() {
  if (typeof window === "undefined") return;
  log("clear");
  sessionStorage.removeItem(KEY);
}
