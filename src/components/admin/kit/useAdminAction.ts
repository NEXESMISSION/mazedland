"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/**
 * Every mutation the console makes, through one door.
 *
 * There are ten hand-rolled copies of this in the admin today — each with its
 * own `fetch`, its own idea of the error shape, its own pending flag, and its
 * own decision about whether to refresh afterwards. They disagree: some show
 * the server's raw `error` code to the operator ("already_claimed"), some
 * swallow failures entirely and leave the row looking approved when it isn't.
 *
 * This hook fixes the shape once:
 *   - a pending flag, so buttons can't be double-fired
 *   - a transient `done` tick for ~1.6 s, so an action that changes nothing
 *     visible still confirms it happened
 *   - server error codes translated to French, with the raw code kept only as
 *     a fallback for something we haven't seen before
 *   - `router.refresh()` on success, so the server-rendered list re-reads the
 *     database rather than trusting the client's guess about the new state
 */

/** Error codes the admin API returns, in the operator's words. */
const MESSAGES: Record<string, string> = {
  auth: "Session expirée. Reconnectez-vous.",
  forbidden: "Vous n'avez pas les droits pour cette action.",
  cross_origin_blocked: "Requête bloquée. Rechargez la page et réessayez.",
  already_claimed: "Un autre admin traite déjà cette ligne.",
  not_found: "Cette ligne n'existe plus — elle a peut-être été supprimée.",
  conflict: "L'état a changé depuis le chargement. Rechargez la page.",
  invalid: "Données invalides.",
  rate_limited: "Trop de requêtes. Patientez un instant.",
};

export type RunOptions = {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Toast shown on success. Pass `null` for a silent action. */
  success?: string | null;
  /** Runs after a successful call, before the refresh. */
  onSuccess?: (data: unknown) => void;
};

export function useAdminAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async ({ url, method = "PATCH", body, success, onSuccess }: RunOptions) => {
      if (pending) return false;
      setPending(true);
      try {
        const res = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        // A non-JSON body here means a proxy or a crash, not our API.
        const data: { error?: string; detail?: string } = await res
          .json()
          .catch(() => ({}));

        if (!res.ok) {
          const known = data.error ? MESSAGES[data.error] : undefined;
          toast(known ?? data.detail ?? data.error ?? "L'action a échoué.", "error");
          return false;
        }

        onSuccess?.(data);
        if (success !== null) toast(success ?? "C'est fait.", "success");

        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1600);

        startTransition(() => router.refresh());
        return true;
      } catch {
        // Network-level failure: the request never got an answer, so the row
        // state on screen is unknown rather than unchanged. Say so.
        toast("Connexion perdue. Vérifiez le réseau et rechargez.", "error");
        return false;
      } finally {
        setPending(false);
      }
    },
    [pending, router, toast],
  );

  return { run, pending, done };
}
