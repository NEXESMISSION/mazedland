"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Check,
  Camera,
  Loader2,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { uploadToBucket } from "@/lib/upload";
import { compressImage } from "@/lib/imageCompress";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Selfie / triptych compression — WebP @ 1280 long edge is plenty for
// admin face-match review and shaves ~60% off the raw canvas JPEG.
const SELFIE_COMPRESS = { maxEdge: 1280, quality: 0.8, format: "webp" } as const;

const TAG = "[Liveness]";
function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(
    `%c${TAG} %c${ts}`,
    "color:#d4af37;font-weight:bold",
    "color:#888",
    ...args,
  );
}
function warn(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(
    `%c${TAG} %c${ts}`,
    "color:#f59e0b;font-weight:bold",
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

type StepId = "front" | "right" | "left";

interface StepDef {
  id: StepId;
  label: string;
  hint: string;
  Icon: typeof Eye;
}

const STEPS: StepDef[] = [
  { id: "front", label: "Regardez devant vous",     hint: "Centrez votre visage face à la caméra", Icon: Eye },
  { id: "right", label: "Tournez la tête à droite", hint: "Doucement, tournez vers votre droite",  Icon: ArrowRight },
  { id: "left",  label: "Tournez la tête à gauche", hint: "Doucement, tournez vers votre gauche",  Icon: ArrowLeft },
];

// Detection thresholds — see the helpers at the bottom for the yaw math.
const HOLD_MS = 800;
const FRONT_YAW_MAX = 0.28;
const SIDE_YAW_MIN = 0.35;
const MIN_FACE_FRAC = 0.12;
const DETECT_INTERVAL_MS = 120;
// Forgive brief drops mid-turn: if the previous frames were valid we keep
// the hold timer running for this long after a NO_FACE / WRONG_POSE / too-small
// frame. Face-api loses the face transiently around 30-40° of yaw, especially
// on the left side, and resetting the timer makes the left step feel impossible.
const HOLD_GRACE_MS = 500;

type FaceApiNs = typeof import("@vladmandic/face-api");
type TinyFaceDetectorOptionsLike = InstanceType<
  FaceApiNs["TinyFaceDetectorOptions"]
>;

export interface LivenessResult {
  /** Storage path of the uploaded triptych (front | right | left). */
  videoUrl: string;
  /** Storage path of the uploaded "looking forward" still image. */
  imageUrl: string;
}

interface Props {
  onComplete: (r: LivenessResult) => void;
  onCancel?: () => void;
}

/**
 * Browser-side guided liveness check. Runs face-api.js against a live
 * webcam preview, walks the user through three head poses (front →
 * right → left), and only advances when the pose has been held for
 * ~1.1s. Three per-pose JPEGs are composed into a single triptych and
 * uploaded to the user's KYC folder; admin still reviews everything.
 */
export function LivenessCheck({ onComplete, onCancel }: Props) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceapiRef = useRef<FaceApiNs | null>(null);
  const detectorOptionsRef = useRef<unknown>(null);
  const heldSinceRef = useRef<number | null>(null);
  const lastGoodFrameAtRef = useRef<number | null>(null);
  const lastDetectAtRef = useRef<number>(0);
  const stoppedRef = useRef<boolean>(false);
  const frontSnapshotRef = useRef<Blob | null>(null);
  const rightSnapshotRef = useRef<Blob | null>(null);
  const leftSnapshotRef = useRef<Blob | null>(null);
  const detectionCountRef = useRef<number>(0);
  const stepIdxRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [phase, setPhase] = useState<
    "boot" | "running" | "uploading" | "done" | "error"
  >("boot");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(
    new Set(),
  );
  const [progress, setProgress] = useState(0);
  const [livePoseHint, setLivePoseHint] = useState<string>(
    "Préparation de la caméra...",
  );

  const totalSteps = STEPS.length;
  const currentStep = STEPS[stepIdx];

  stepIdxRef.current = stepIdx;

  /* ───────── Boot: load models + camera ───────── */
  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;
    log("boot start", {
      hasMediaDevices: typeof navigator !== "undefined" && !!navigator.mediaDevices,
      hasMediaRecorder: typeof MediaRecorder !== "undefined",
      thresholds: { HOLD_MS, FRONT_YAW_MAX, SIDE_YAW_MIN, MIN_FACE_FRAC, DETECT_INTERVAL_MS },
    });

    if (!audioCtxRef.current) {
      audioCtxRef.current = makeAudioCtx();
      log("AudioContext created", {
        state: audioCtxRef.current?.state ?? "unsupported",
      });
    }
    audioCtxRef.current?.resume().then(
      () => log("AudioContext resumed eagerly", { state: audioCtxRef.current?.state }),
      (e) => warn("AudioContext eager resume failed (will retry on gesture)", e?.message ?? e),
    );
    const onGesture = () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== "running") {
        audioCtxRef.current.resume().then(
          () => log("AudioContext unlocked by gesture"),
          (e) => warn("gesture resume failed", e?.message ?? e),
        );
      }
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("touchstart", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });

    (async () => {
      const tBoot = performance.now();
      try {
        setLivePoseHint("Chargement du modèle de visage...");

        const tImport = performance.now();
        const faceapi = await import("@vladmandic/face-api");
        log("face-api module imported", { ms: Math.round(performance.now() - tImport) });
        if (cancelled) return;
        faceapiRef.current = faceapi;

        const tDetector = performance.now();
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models/face-api");
        log("tinyFaceDetector loaded", { ms: Math.round(performance.now() - tDetector) });

        const tLandmarks = performance.now();
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models/face-api");
        log("faceLandmark68TinyNet loaded", { ms: Math.round(performance.now() - tLandmarks) });

        detectorOptionsRef.current = new faceapi.TinyFaceDetectorOptions({
          inputSize: 320,
          scoreThreshold: 0.5,
        });

        if (cancelled) return;
        setLivePoseHint("Demande d'accès à la caméra...");

        const tCam = performance.now();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() ?? {};
        log("camera granted", {
          ms: Math.round(performance.now() - tCam),
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          facingMode: settings.facingMode,
          deviceId: settings.deviceId,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          log("boot cancelled after camera — stream closed");
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current
            .play()
            .then(() => log("video element playing"))
            .catch((e) => warn("video.play() rejected", e));
        } else {
          warn("videoRef is null at stream attach");
        }

        setPhase("running");
        setLivePoseHint("Suivez les étapes ci-dessous");
        log("boot done — entering running phase", {
          totalMs: Math.round(performance.now() - tBoot),
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const errName = (e as { name?: string })?.name;
        const errMessage = e instanceof Error ? e.message : String(e);
        let userMsg = "Impossible d'initialiser la caméra";
        if (errName === "NotAllowedError") {
          userMsg = "Permission caméra refusée — autorisez puis réessayez";
        } else if (errName === "NotFoundError" || errName === "OverconstrainedError") {
          userMsg = "Aucune caméra avant détectée sur cet appareil";
        } else if (errName === "NotReadableError" || errName === "AbortError") {
          userMsg = "La caméra est utilisée par une autre application";
        } else if (errName === "SecurityError") {
          userMsg = "La caméra requiert une connexion sécurisée (HTTPS)";
        } else if (errMessage.includes("Failed to fetch") || errMessage.includes("404")) {
          userMsg = "Échec du chargement du modèle de détection — actualisez la page";
        }
        err("boot FAILED", {
          name: errName,
          msg: errMessage,
          userMsg,
          isSecureContext: window.isSecureContext,
          protocol: window.location.protocol,
          error: e,
        });
        setErrorMsg(userMsg);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      log("unmount — stopping streams + recorder");
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
      audioCtxRef.current?.close().catch(() => null);
      audioCtxRef.current = null;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── Detection loop ───────── */
  useEffect(() => {
    if (phase !== "running") return;
    log("detection loop START", {
      step: STEPS[stepIdxRef.current].id,
      videoReadyState: videoRef.current?.readyState,
      videoDims: {
        w: videoRef.current?.videoWidth,
        h: videoRef.current?.videoHeight,
      },
    });
    let cancelled = false;
    let raf = 0;
    let firstFrameLogged = false;
    const tick = async () => {
      if (cancelled || stoppedRef.current) return;
      const now = performance.now();
      const v = videoRef.current;
      const ready = !!v && v.readyState >= 2 && !!faceapiRef.current;
      if (!firstFrameLogged && ready) {
        firstFrameLogged = true;
        log("first usable frame", {
          readyState: v!.readyState,
          videoW: v!.videoWidth,
          videoH: v!.videoHeight,
        });
      }
      if (now - lastDetectAtRef.current >= DETECT_INTERVAL_MS && ready) {
        lastDetectAtRef.current = now;
        await runDetection();
        if (cancelled || stoppedRef.current) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      log("detection loop STOP", {
        detections: detectionCountRef.current,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function playStepBeep() {
    try {
      navigator.vibrate?.(18);
    } catch {
      // ignore
    }
    const ctx = audioCtxRef.current;
    if (!ctx) {
      warn("beep skipped — no AudioContext");
      return;
    }
    const r = await playSequence(ctx, BEEP_STEP);
    if (!r.ok) warn("step beep failed", r.reason);
    else log("step beep played");
  }
  async function playDoneBeep() {
    try {
      navigator.vibrate?.([20, 60, 25, 60, 35]);
    } catch {
      // ignore
    }
    const ctx = audioCtxRef.current;
    if (!ctx) {
      warn("done beep skipped — no AudioContext");
      return;
    }
    const r = await playSequence(ctx, BEEP_DONE);
    if (!r.ok) warn("done beep failed", r.reason);
    else log("done beep played");
  }

  const runDetection = useCallback(async () => {
    const video = videoRef.current;
    const faceapi = faceapiRef.current;
    if (!video || !faceapi || !detectorOptionsRef.current) return;
    const idx = stepIdxRef.current;
    const stepId = STEPS[idx].id;

    const tDet = performance.now();
    const det = await faceapi
      .detectSingleFace(
        video,
        detectorOptionsRef.current as TinyFaceDetectorOptionsLike,
      )
      .withFaceLandmarks(true);
    const detMs = Math.round(performance.now() - tDet);
    detectionCountRef.current += 1;

    const idxAfter = stepIdxRef.current;
    if (idxAfter !== idx) return;

    // Helper: forgive transient detection failures during a hold. If a hold
    // is already in progress AND we saw a valid frame within HOLD_GRACE_MS,
    // we leave the timer alone — the user is just briefly out-of-frame as
    // they finish the turn, not starting over.
    const softReset = (_reason: "no_face" | "too_small" | "wrong_pose") => {
      const now = performance.now();
      const lastGood = lastGoodFrameAtRef.current;
      const withinGrace =
        heldSinceRef.current !== null &&
        lastGood !== null &&
        now - lastGood <= HOLD_GRACE_MS;
      if (!withinGrace) {
        heldSinceRef.current = null;
        setProgress(0);
      }
      return withinGrace;
    };

    if (!det) {
      setLivePoseHint("Aucun visage détecté — placez-vous devant la caméra");
      softReset("no_face");
      if (detectionCountRef.current % 8 === 0) {
        log("detect: NO FACE", { detMs, step: stepId });
      }
      return;
    }
    const box = det.detection.box;
    const videoW = video.videoWidth || 1;
    const faceFrac = box.width / videoW;
    const score = det.detection.score;

    if (faceFrac < MIN_FACE_FRAC) {
      setLivePoseHint("Rapprochez-vous un peu de la caméra");
      softReset("too_small");
      if (detectionCountRef.current % 8 === 0) {
        log("detect: TOO_SMALL", {
          detMs,
          score: round(score, 2),
          faceFrac: round(faceFrac, 3),
          minFaceFrac: MIN_FACE_FRAC,
          step: stepId,
        });
      }
      return;
    }

    const yaw = computeYaw(det.landmarks);
    const pass = stepPasses(stepId, yaw);

    if (!pass.ok) {
      setLivePoseHint(pass.hint);
      softReset("wrong_pose");
      if (detectionCountRef.current % 5 === 0) {
        log("detect: WRONG_POSE", {
          detMs,
          score: round(score, 2),
          yaw: round(yaw, 3),
          step: stepId,
          hint: pass.hint,
        });
      }
      return;
    }

    setLivePoseHint("Maintenez la position...");
    lastGoodFrameAtRef.current = performance.now();
    const startedHold = heldSinceRef.current === null;
    if (startedHold) {
      heldSinceRef.current = performance.now();
      log("detect: HOLD_START", {
        step: stepId,
        yaw: round(yaw, 3),
        score: round(score, 2),
        faceFrac: round(faceFrac, 3),
      });
    }
    const elapsed = performance.now() - heldSinceRef.current!;
    setProgress(Math.min(1, elapsed / HOLD_MS));

    if (elapsed >= HOLD_MS) {
      log("STEP_DONE", {
        step: stepId,
        holdMs: Math.round(elapsed),
        yaw: round(yaw, 3),
        score: round(score, 2),
      });
      try {
        const tSnap = performance.now();
        const blob = await canvasSnapshot(video);
        if (stepId === "front") frontSnapshotRef.current = blob;
        else if (stepId === "right") rightSnapshotRef.current = blob;
        else if (stepId === "left") leftSnapshotRef.current = blob;
        log(`${stepId} snapshot captured`, {
          ms: Math.round(performance.now() - tSnap),
          sizeBytes: blob.size,
        });
      } catch (e) {
        warn(`${stepId} snapshot failed`, e);
      }
      heldSinceRef.current = null;
      lastGoodFrameAtRef.current = null;
      setProgress(0);
      setCompletedSteps((s) => {
        const next = new Set(s);
        next.add(stepId);
        return next;
      });
      if (idx + 1 < totalSteps) {
        log("advancing to next step", {
          from: stepId,
          to: STEPS[idx + 1].id,
        });
        playStepBeep();
        stepIdxRef.current = idx + 1;
        setStepIdx(idx + 1);
      } else {
        log("all steps complete — finalizing");
        playDoneBeep();
        finalize();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSteps]);

  /* ───────── Finalize: upload triptych + front frame ───────── */
  async function finalize() {
    if (stoppedRef.current) {
      log("finalize() called but already stopped — ignoring");
      return;
    }
    stoppedRef.current = true;
    setPhase("uploading");
    setLivePoseHint("Validation et envoi...");

    const supabase = getBrowserSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const liveUser = authData?.user ?? null;
    log("finalize start", {
      hasUserFromHook: Boolean(user),
      hasUserFromFetch: Boolean(liveUser),
      front: Boolean(frontSnapshotRef.current),
      right: Boolean(rightSnapshotRef.current),
      left: Boolean(leftSnapshotRef.current),
      authErr: authErr?.message,
    });
    if (!liveUser) {
      err("finalize: NO USER — aborting", { authErr });
      setErrorMsg("Vous devez être connecté pour soumettre la vérification");
      setPhase("error");
      return;
    }

    if (!frontSnapshotRef.current && videoRef.current) {
      log("front snapshot missing — falling back to current frame");
      try {
        frontSnapshotRef.current = await canvasSnapshot(videoRef.current);
      } catch (e) {
        warn("fallback front snapshot failed", e);
      }
    }

    try {
      const tImg = performance.now();
      const rawImgFile = new File(
        [frontSnapshotRef.current ?? new Blob([])],
        `liveness-front-${Date.now()}.jpg`,
        { type: "image/jpeg" },
      );
      // Re-encode through the shared pipeline: canvas-JPEG → WebP, with
      // EXIF orientation honoured (not that a same-tab canvas blob has
      // any EXIF, but the size win still applies). Typically drops a
      // ~250 KB JPEG to ~90–130 KB WebP without visible difference on
      // an admin's review screen.
      const imgFile = await compressImage(rawImgFile, SELFIE_COMPRESS);
      log("uploading front image", {
        rawKB: Math.round(rawImgFile.size / 1024),
        finalKB: Math.round(imgFile.size / 1024),
      });
      const imgRes = await uploadToBucket(imgFile, liveUser.id, "kyc");
      log("front image upload done", {
        ms: Math.round(performance.now() - tImg),
        url: imgRes.url,
      });

      let triptychUrl = imgRes.url;
      const triptychBlob = await composeTriptych(
        frontSnapshotRef.current,
        rightSnapshotRef.current,
        leftSnapshotRef.current,
      );
      if (triptychBlob) {
        const tTri = performance.now();
        const rawTriFile = new File(
          [triptychBlob],
          `liveness-triptych-${Date.now()}.jpg`,
          { type: "image/jpeg" },
        );
        const triFile = await compressImage(rawTriFile, SELFIE_COMPRESS);
        log("uploading triptych", {
          rawKB: Math.round(rawTriFile.size / 1024),
          finalKB: Math.round(triFile.size / 1024),
        });
        const triRes = await uploadToBucket(triFile, liveUser.id, "kyc");
        triptychUrl = triRes.url;
        log("triptych upload done", {
          ms: Math.round(performance.now() - tTri),
          url: triRes.url,
        });
      } else {
        log("triptych skipped — using front URL for both slots");
      }

      stopAll();
      setPhase("done");
      log("finalize SUCCESS", {
        imageUrl: imgRes.url,
        triptychUrl,
      });
      onComplete({ videoUrl: triptychUrl, imageUrl: imgRes.url });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Échec de l'envoi du selfie";
      err("upload FAILED", { msg, error: e });
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  function stopAll() {
    log("stopAll() called", {
      hadStream: Boolean(streamRef.current),
      detectionsRun: detectionCountRef.current,
    });
    stoppedRef.current = true;
    streamRef.current?.getTracks().forEach((t) => {
      log("stopping track", { kind: t.kind, label: t.label, readyState: t.readyState });
      t.stop();
    });
    streamRef.current = null;
  }

  function restart() {
    log("restart() — re-mount via parent key");
    stopAll();
    setPhase("boot");
    setStepIdx(0);
    setCompletedSteps(new Set());
    setProgress(0);
    heldSinceRef.current = null;
    frontSnapshotRef.current = null;
    rightSnapshotRef.current = null;
    leftSnapshotRef.current = null;
    detectionCountRef.current = 0;
    stoppedRef.current = false;
    if (onCancel) onCancel();
  }

  /* ───────── Render ───────── */
  return (
    <div className="space-y-4">
      <div className="relative aspect-[3/4] rounded-[var(--radius-md)] overflow-hidden bg-black ring-2 ring-[var(--border)]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {phase === "boot" && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white text-sm">
            <Loader2 className="h-5 w-5 me-2 animate-spin text-[var(--gold)]" />
            {livePoseHint}
          </div>
        )}

        {phase === "error" && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center text-white text-sm p-6 text-center gap-3">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <div className="font-bold">Impossible d&apos;initialiser la caméra</div>
            <div className="text-xs text-white/80">{errorMsg}</div>
            {onCancel && (
              <Button size="sm" variant="secondary" onClick={onCancel}>
                Retour
              </Button>
            )}
          </div>
        )}

        {phase === "uploading" && (
          <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-white text-sm">
            <Loader2 className="h-5 w-5 me-2 animate-spin text-[var(--gold)]" />
            Envoi en cours...
          </div>
        )}

        {phase === "done" && (
          <div className="absolute inset-0 bg-emerald-500/30 backdrop-blur-sm flex flex-col items-center justify-center text-white text-sm">
            <div className="h-14 w-14 rounded-full bg-emerald-500 flex items-center justify-center mb-2">
              <Check className="h-7 w-7" strokeWidth={3} />
            </div>
            <div className="font-bold">Selfie validé</div>
          </div>
        )}

        {phase === "running" && (
          <>
            <div className="absolute top-3 inset-x-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold">
                <Camera className="h-3 w-3 text-[var(--gold)]" />
                {stepIdx + 1} / {totalSteps}
              </span>
            </div>

            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-full bg-black/55 backdrop-blur-md border-2 border-[var(--gold)] flex items-center justify-center">
                <currentStep.Icon className="h-8 w-8 text-[var(--gold)]" />
              </div>
              <div className="px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-md text-white text-[13px] font-extrabold leading-tight text-center">
                {currentStep.label}
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 p-3 space-y-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
              <div className="text-[11px] text-white/85 text-center">
                {livePoseHint}
              </div>
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-[var(--gold)] transition-[width] duration-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <ol className="rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--border)]">
        {STEPS.map((s, i) => {
          const done = completedSteps.has(s.id);
          const active = phase === "running" && i === stepIdx;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                active ? "bg-[var(--gold-faint)]" : ""
              }`}
            >
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-[var(--gold)] text-white animate-pulse"
                      : "bg-[var(--surface-2)] text-[var(--foreground-muted)]"
                }`}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  <s.Icon className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[13px] font-semibold leading-tight ${
                    done
                      ? "line-through text-[var(--foreground-muted)]"
                      : active
                        ? "text-[var(--gold)]"
                        : ""
                  }`}
                >
                  {s.label}
                </div>
                {!done && (
                  <div className="text-[10px] text-[var(--foreground-muted)] mt-0.5">
                    {s.hint}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {phase === "error" && (
        <Button size="md" fullWidth variant="secondary" onClick={restart}>
          <RefreshCw className="h-4 w-4" />
          Réessayer
        </Button>
      )}
    </div>
  );
}

/* ───────── Helpers ───────── */

interface FaceLandmarks68Like {
  positions: { x: number; y: number }[];
}

function computeYaw(landmarks: FaceLandmarks68Like): number {
  // Eye-based yaw — much more stable than jaw-based across head
  // rotations. The jaw indices get squished together when the head
  // turns and the half-width denominator collapses, producing values
  // outside the normalised [-1, 1] signal.
  //
  // 36 = subject's right eye OUTER corner (image-left in raw frame).
  // 45 = subject's left eye OUTER corner (image-right in raw frame).
  // 30 = nose tip.
  const eyeL = landmarks.positions[36];
  const eyeR = landmarks.positions[45];
  const nose = landmarks.positions[30];
  if (!eyeL || !eyeR || !nose) return 0;
  const center = (eyeL.x + eyeR.x) / 2;
  const half = (eyeR.x - eyeL.x) / 2;
  if (half <= 0) return 0;
  return (nose.x - center) / half;
}

function stepPasses(
  step: StepId,
  yaw: number,
): { ok: boolean; hint: string } {
  const abs = Math.abs(yaw);
  if (step === "front") {
    if (abs < FRONT_YAW_MAX) return { ok: true, hint: "Bien centré" };
    return { ok: false, hint: "Centrez votre visage" };
  }
  if (step === "right") {
    if (yaw < -SIDE_YAW_MIN) return { ok: true, hint: "Maintenez la position" };
    return { ok: false, hint: "Tournez plus la tête à droite" };
  }
  if (yaw > SIDE_YAW_MIN) return { ok: true, hint: "Maintenez la position" };
  return { ok: false, hint: "Tournez plus la tête à gauche" };
}

async function canvasSnapshot(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth || 720;
  const h = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("BLOB_FAILED"))),
      "image/jpeg",
      0.85,
    );
  });
}

/**
 * Compose three liveness pose JPEGs into a single horizontal triptych:
 * front | right | left, each panel 480×480, gold separator strips
 * between them. Replaces a MediaRecorder pipeline that was 3-8 MB and
 * stalled the upload — triptych is ~150-300 KB and shows admin the
 * three poses they need to see at a glance.
 */
async function composeTriptych(
  front: Blob | null,
  right: Blob | null,
  left: Blob | null,
): Promise<Blob | null> {
  const blobs = [front, right, left];
  if (!blobs.some((b) => b)) return null;
  const PANEL = 480;
  const GAP = 6;
  const W = PANEL * 3 + GAP * 2;
  const H = PANEL;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 3; i++) {
    const blob = blobs[i];
    if (!blob) continue;
    try {
      const bmp = await createImageBitmap(blob);
      const x = i * (PANEL + GAP);
      const ratio = bmp.width / bmp.height;
      let sx = 0,
        sy = 0,
        sw = bmp.width,
        sh = bmp.height;
      if (ratio > 1) {
        sw = bmp.height;
        sx = (bmp.width - sw) / 2;
      } else if (ratio < 1) {
        sh = bmp.width;
        sy = (bmp.height - sh) / 2;
      }
      ctx.drawImage(bmp, sx, sy, sw, sh, x, 0, PANEL, PANEL);
      bmp.close?.();
    } catch {
      // Skip the panel; the dark background fills the slot.
    }
  }

  ctx.fillStyle = "#d4af37";
  ctx.fillRect(PANEL, 0, GAP, H);
  ctx.fillRect(PANEL * 2 + GAP, 0, GAP, H);

  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
  );
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

type AudioCtxCtor = typeof AudioContext;
interface WebkitWindow {
  webkitAudioContext?: AudioCtxCtor;
}

function makeAudioCtx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

async function playSequence(
  ctx: AudioContext,
  sequence: Array<[number, number]>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (e) {
      return { ok: false, reason: `resume() rejected: ${(e as Error)?.message ?? "unknown"}` };
    }
  }
  if (ctx.state !== "running") {
    return { ok: false, reason: `ctx state is ${ctx.state}` };
  }
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = 0;
  let t = ctx.currentTime + 0.02;
  for (const [freq, durMs] of sequence) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    const dur = durMs / 1000;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
    t += dur + 0.04;
  }
  return { ok: true };
}

const BEEP_STEP = [[880, 130]] as Array<[number, number]>;
const BEEP_DONE = [
  [660, 110],
  [880, 110],
  [1175, 200],
] as Array<[number, number]>;
