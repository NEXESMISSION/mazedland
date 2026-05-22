"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself (above
 * the [locale] error boundary). It must render its own <html>/<body> because
 * it replaces the root layout. Kept dependency-free (no intl, no design
 * tokens guaranteed) so it can't fail to render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[boundary] global error", {
      message: error?.message,
      digest: error?.digest,
    });
  }, [error]);

  return (
    <html lang="fr">
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
          background: "#0a0a0a",
          color: "#f5f5f5",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          Une erreur est survenue
        </h1>
        <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 360, margin: 0 }}>
          L&apos;application a rencontré un problème inattendu. Réessayez ; si
          cela persiste, signalez-le à l&apos;équipe.
        </p>
        {error?.digest && (
          <p style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
            ref · {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            height: 44,
            padding: "0 24px",
            borderRadius: 999,
            border: "none",
            background: "#c9a227",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
