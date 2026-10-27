"use client";

import { createContext, useContext } from "react";
import { canOpen, type AdminScopes, type ConsoleSection } from "@/lib/admin/sections";

/**
 * The signed-in member's sections, for the console's navigation: the rail,
 * the Site tabs and the hub show only what this member may open. Hiding is a
 * courtesy — every page and route checks again on the server.
 */
const ScopesContext = createContext<AdminScopes>(null);

export function AdminScopesProvider({ scopes, children }: { scopes: AdminScopes; children: React.ReactNode }) {
  return <ScopesContext.Provider value={scopes}>{children}</ScopesContext.Provider>;
}

/** Whether the signed-in member may open `section` (no section = any member). */
export function useCanOpen(): (section?: ConsoleSection) => boolean {
  const scopes = useContext(ScopesContext);
  return (section) => canOpen(scopes, section);
}
