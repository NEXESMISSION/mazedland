/**
 * The page a `?page=` parameter asks for: a whole number from 1. Anything
 * else — absent, « abc », 0, a negative — is the first page, so a hand-typed
 * or stale address never asks the database for a range it cannot serve.
 *
 * Shared by the catalogue and the agence pages so both read the same address
 * the same way.
 */
export function pageNumber(raw: string | undefined): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}
