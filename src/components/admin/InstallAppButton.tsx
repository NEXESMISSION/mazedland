"use client";

import { InstallButton } from "@/components/layout/InstallButton";

/**
 * « Installer l'app » in the console: the console as an app (the admin layout
 * points at /admin.webmanifest, so it opens on the console). Always shown
 * until it is installed — the browser's own prompt where there is one, the
 * steps by hand everywhere else (src/components/layout/InstallButton.tsx).
 */
export function InstallAppButton({ variant = "row" }: { variant?: "row" | "icon" }) {
  return <InstallButton scope="admin" variant={variant} />;
}
