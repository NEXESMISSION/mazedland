/**
 * Payments, server side: whether anyone can pay right now (see `paymentsOpen`
 * in ./index.ts), from the settings an admin fills in /admin/settings.
 *
 *   if (!(await paymentsAreOpen())) → show the notice, not the button
 *   const closed = await paymentsClosed(); if (closed) return closed;  // in a route
 */
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings/server";
import { paymentsOpen } from "./index";

/** Once per request (getSettings is cached), however many parts of a page ask. */
export async function paymentsAreOpen(): Promise<boolean> {
  return paymentsOpen(await getSettings());
}

/**
 * The API side: a route that would create a payment answers 503
 * `payments_closed` while no payee method is usable, rather than leave a
 * pending payment behind that nobody can pay. The pages hide the button in the
 * same case, so this only meets a tab kept open, or a script.
 */
export async function paymentsClosed(): Promise<NextResponse | null> {
  return (await paymentsAreOpen())
    ? null
    : NextResponse.json({ error: "payments_closed" }, { status: 503 });
}
