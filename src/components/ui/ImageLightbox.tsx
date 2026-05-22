"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * Click any image → opens it in a full-screen popup (no new tab) with
 * zoom + pan: mouse wheel, +/- buttons, double-click/tap to toggle, and
 * two-finger pinch on touch. Drag to pan when zoomed in.
 *
 * Two trigger forms:
 *   <ImageLightbox src=... thumbClassName="..." />            // renders the thumb
 *   <ImageLightbox src=... triggerClassName="...">…</…>       // wrap custom markup
 */
export function ImageLightbox({
  src,
  alt = "",
  thumbClassName,
  triggerClassName,
  children,
}: {
  src: string;
  alt?: string;
  thumbClassName?: string;
  triggerClassName?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      {children ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={"block cursor-zoom-in " + (triggerClassName ?? "")}
        >
          {children}
        </button>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onClick={() => setOpen(true)}
          className={"cursor-zoom-in " + (thumbClassName ?? "")}
        />
      )}
      {open && mounted &&
        createPortal(<Viewer src={src} alt={alt} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastDist = useRef(0);
  const lastPan = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const clamp = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  function reset() {
    setScale(1);
    setTx(0);
    setTy(0);
  }
  function zoomBy(factor: number) {
    setScale((s) => {
      const ns = clamp(s * factor);
      if (ns === 1) {
        setTx(0);
        setTy(0);
      }
      return ns;
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }

  function onDoubleClick() {
    if (scale > 1) reset();
    else setScale(2.5);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 1) {
      lastPan.current = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      lastDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist.current > 0) zoomBy(dist / lastDist.current);
      lastDist.current = dist;
      moved.current = true;
    } else if (scale > 1 && lastPan.current) {
      const dx = e.clientX - lastPan.current.x;
      const dy = e.clientY - lastPan.current.y;
      lastPan.current = { x: e.clientX, y: e.clientY };
      setTx((v) => v + dx);
      setTy((v) => v + dy);
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastDist.current = 0;
    const remaining = [...pointers.current.values()];
    lastPan.current = remaining.length === 1 ? remaining[0] : null;
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={(e) => {
        // Close only on a genuine backdrop click (not after a pan/pinch).
        if (e.target === e.currentTarget && !moved.current) onClose();
      }}
    >
      {/* Controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <ControlButton label="Dézoomer" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOut className="size-5" />
        </ControlButton>
        <ControlButton label="Zoomer" onClick={() => zoomBy(1.4)}>
          <ZoomIn className="size-5" />
        </ControlButton>
        <ControlButton label="Réinitialiser" onClick={reset}>
          <Maximize2 className="size-5" />
        </ControlButton>
        <ControlButton label="Fermer" onClick={onClose}>
          <X className="size-5" />
        </ControlButton>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: pointers.current.size > 0 ? "none" : "transform 120ms ease-out",
          touchAction: "none",
          cursor: scale > 1 ? "grab" : "zoom-in",
        }}
        className="max-h-[92vh] max-w-[94vw] select-none object-contain"
      />

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/70">
        Molette / pincer pour zoomer · glisser pour déplacer
      </div>
    </div>
  );
}

function ControlButton({
  label, onClick, children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
    >
      {children}
    </button>
  );
}
