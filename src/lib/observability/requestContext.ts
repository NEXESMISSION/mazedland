import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request correlation id. A single id is generated at the request boundary
 * (withRouteLogger) and stored in AsyncLocalStorage for the lifetime of that
 * request, so EVERY log line and the error response body for that request share
 * one id — real cross-line correlation, not a fresh random per fail() call.
 *
 * All API routes run on the Node runtime (no `export const runtime='edge'`
 * anywhere), so node:async_hooks is available. Routes not yet wrapped in
 * withRouteLogger simply have no store → fail() falls back to a per-call id,
 * which is still a valid (if non-spanning) correlation token.
 */
const als = new AsyncLocalStorage<{ requestId: string }>();

export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return als.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}
