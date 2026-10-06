"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself (above
 * the [locale] error boundary). It must render its own <html>/<body> because
 * it replaces the root layout. Kept dependency-free (no intl, no design
 * tokens guaranteed) so it can't fail to render.
 */
const BLOCK: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.75rem",
  width: "100%",
  maxWidth: 360,
};

const BUTTON: React.CSSProperties = {
  height: 44,
  padding: "0 24px",
  borderRadius: 999,
  border: "none",
  background: "#18181b",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boundary] global error", {
      message: error?.message,
      digest: error?.digest,
    });
    // Ship to the observability sink so a ROOT-layout crash lands in the same
    // server-side stream + /admin/activity as every other error — not just the
    // user's browser console (where no operator ever sees it). Best-effort +
    // keepalive so the beacon survives the boundary re-render; never throws.
    try {
      fetch("/api/observability/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "global_error",
          message: error?.message ?? "(no message)",
          stack: error?.stack,
          url: typeof window !== "undefined" ? window.location.href : undefined,
          source: error?.digest ? `digest:${error.digest}` : undefined,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* observability must never break the last-resort boundary */
    }
  }, [error]);

  return (
    // No intl provider up here and no way to know the reader's language (the
    // [locale] layout is what failed), so — like the root not-found page — it
    // says it in French and in Arabic, each block with its own retry button.
    <html lang="fr" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#ffffff",
          color: "#18181b",
        }}
      >
        <section style={BLOCK}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Une erreur est survenue
          </h1>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 360, margin: 0 }}>
            L&apos;application a rencontré un problème inattendu. Réessayez ; si
            cela persiste, signalez-le à l&apos;équipe.
          </p>
          <button type="button" onClick={reset} style={BUTTON}>
            Réessayer
          </button>
        </section>

        <section
          lang="ar"
          dir="rtl"
          style={{ ...BLOCK, borderTop: "1px solid #e4e4e7", paddingTop: "1.5rem", marginTop: "0.5rem" }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>صار مشكل</h2>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 360, margin: 0 }}>
            تعرّض التطبيق لمشكلة غير متوقّعة. أعد المحاولة؛ وإذا استمرّت المشكلة،
            أبلغ الفريق بها.
          </p>
          <button type="button" onClick={reset} style={BUTTON}>
            عاود جرّب
          </button>
        </section>

        {error?.digest && (
          <p style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace", margin: 0 }}>
            ref · {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
