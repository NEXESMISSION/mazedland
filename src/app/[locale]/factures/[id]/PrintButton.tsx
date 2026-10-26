"use client";

import { Printer } from "lucide-react";

/** Prints the document alone (globals.css @media print). */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-1.5 px-4 text-[13px]"
    >
      <Printer className="size-4" /> {label}
    </button>
  );
}
