"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * After a fresh KYC submission the "Vérification en cours" screen is just a
 * brief confirmation — we don't trap the user on a waiting page. Bounce them
 * to the home feed after a few seconds so they can keep browsing while their
 * file is reviewed.
 */
export function AutoHomeRedirect({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setTimeout(() => router.replace("/"), seconds * 1000);
    return () => clearTimeout(id);
  }, [router, seconds]);
  return null;
}
