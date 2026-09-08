"use client";

import { useSyncExternalStore } from "react";

/**
 * True once the client has hydrated; false during SSR and the first render.
 *
 * Every portal-based component here carried its own copy of:
 *
 *     const [mounted, setMounted] = useState(false);
 *     useEffect(() => setMounted(true), []);
 *
 * which works, but costs an extra render pass on mount and is exactly the
 * pattern `react-hooks/set-state-in-effect` warns about — a state write in an
 * effect purely to learn something the renderer already knows.
 *
 * `useSyncExternalStore` answers it directly: React calls `getServerSnapshot`
 * while rendering on the server and during hydration, and `getSnapshot`
 * afterwards. Returning different constants from the two is the documented way
 * to ask "am I hydrated yet".
 *
 * `subscribe` returns a no-op teardown because the answer never changes after
 * hydration — there is nothing to subscribe to.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
