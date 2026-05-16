"use client";

import { useEffect, useState, useCallback } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * App-side user shape. Maps the Supabase auth user + the public.profiles
 * row into a single object the KYC + seller flows can read straight from.
 *
 * `firstName` / `lastName` are derived from the profile's `full_name`
 * (best-effort split on the first space) so the same KYC pages that work
 * in mazed-auto land here without a column rename.
 */
export interface AppUser {
  id: string;
  email: string | null;
  fullName: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: "individual" | "agency" | "bank" | "bailiff" | "inspector" | "admin";
  kycStatus: "none" | "submitted" | "pending" | "verified" | "rejected";
  language: "ar" | "fr" | "en";
}

function splitName(full: string | null): { firstName: string; lastName: string } {
  if (!full) return { firstName: "", lastName: "" };
  const trimmed = full.trim();
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
}

/**
 * Minimal client-side auth hook used by the KYC + seller flows.
 *
 * Differences from mazed-auto's useAuth:
 *   - We don't pull from a shared AuthProvider; each consumer pays one
 *     getUser() + one profiles read on mount. Cheap for the KYC pages.
 *   - `update({ kycStatus })` is intentionally a NO-OP server-side —
 *     the profile-guard trigger blocks self-mutation of kyc_status.
 *     The kyc_submissions insert trigger mirrors the status to the
 *     profile automatically (see 0006_security_lockdown.sql). We update
 *     the LOCAL user state so the UI feels instant; the next navigation
 *     fetches the fresh profile from the DB.
 */
export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;

    async function load() {
      const { data } = await supabase.auth.getUser();
      const authUser = data.user;
      if (!authUser) {
        if (!cancelled) {
          setUser(null);
          setLoaded(true);
        }
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, role, kyc_status, language")
        .eq("id", authUser.id)
        .single();
      if (cancelled) return;
      const { firstName, lastName } = splitName(profile?.full_name ?? null);
      setUser({
        id: authUser.id,
        email: authUser.email ?? null,
        fullName: profile?.full_name ?? null,
        firstName,
        lastName,
        phone: profile?.phone ?? null,
        role: (profile?.role as AppUser["role"]) ?? "individual",
        kycStatus: (profile?.kyc_status as AppUser["kycStatus"]) ?? "none",
        language: (profile?.language as AppUser["language"]) ?? "ar",
      });
      setLoaded(true);
    }
    load();

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { id: string } | null } | null) => {
        if (!session?.user) {
          setUser(null);
        } else {
          // Re-load profile on auth state change so role / kyc_status are fresh.
          load();
        }
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * Optimistic local update. The DB-side mirror is handled by the
   * kyc_submissions insert trigger (`0006_security_lockdown.sql` →
   * `_mirror_kyc_submission`). This local set just makes the UI react
   * instantly without waiting for a profile re-fetch.
   */
  const update = useCallback(
    async (patch: Partial<AppUser>) => {
      setUser((prev) => (prev ? { ...prev, ...patch } : prev));
      return { error: null };
    },
    [],
  );

  return { user, loaded, update };
}
