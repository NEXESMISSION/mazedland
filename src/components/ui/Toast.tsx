"use client";

import * as React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextType {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = React.createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast = React.useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const newId = ++id;
      setToasts((prev) => [...prev, { id: newId, message, variant }]);
      // Auto-dismiss timeout scales with severity — long errors need
      // more reading time than a success ack.
      const ms = variant === "error" || variant === "warning" ? 4500 : 1800;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newId));
      }, ms);
    },
    [],
  );

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Top-anchored stack — sits below the status bar with safe-area
          padding so notifications never collide with the bottom tab bar.
          aria-live so screen-reader users hear toasts; assertive because
          most are action results (errors/confirmations) the user is waiting
          on. role="status" keeps it a non-interrupting live region. */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="false"
        className="fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const variantStyles: Record<
  ToastVariant,
  { icon: React.ElementType; accent: string; iconColor: string }
> = {
  success: {
    icon: CheckCircle2,
    accent: "bg-emerald-400",
    iconColor: "text-emerald-400",
  },
  error: {
    icon: XCircle,
    accent: "bg-[var(--danger)]",
    iconColor: "text-[var(--danger)]",
  },
  warning: {
    icon: AlertTriangle,
    accent: "bg-amber-400",
    iconColor: "text-amber-400",
  },
  info: {
    icon: Info,
    accent: "bg-[var(--gold)]",
    iconColor: "text-[var(--gold)]",
  },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { icon: Icon, accent, iconColor } = variantStyles[toast.variant];
  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-[var(--max-w)]",
        "relative overflow-hidden rounded-2xl",
        "bg-[var(--surface)]/95 backdrop-blur-md border border-[var(--border)]",
        "shadow-[0_12px_32px_rgba(0,0,0,0.6)]",
        "px-4 py-3 flex items-center gap-3",
        "animate-fade-in",
      )}
    >
      <span className={cn("absolute inset-y-0 start-0 w-1", accent)} />
      <Icon className={cn("h-5 w-5 shrink-0", iconColor)} />
      <div className="flex-1 text-sm text-foreground leading-snug">
        {toast.message}
      </div>
      <button
        onClick={onClose}
        aria-label="Fermer"
        className="tap-target shrink-0 rounded-full flex items-center justify-center text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
