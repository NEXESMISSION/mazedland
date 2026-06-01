"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transient success flag for action buttons. Call `flashDone()` in a
 * successful submit branch; `done` flips true and auto-resets after `ms`,
 * so a <Button done={done} doneLabel="Enregistré ✓"> shows an on-button
 * confirmation before returning to its idle label.
 *
 *   const [done, flashDone] = useTransientDone();
 *   ...
 *   if (res.ok) flashDone();
 *   <Button pending={isPending} done={done} doneLabel="Envoyé">Envoyer</Button>
 */
export function useTransientDone(ms = 1500): [boolean, () => void] {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashDone = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDone(true);
    timer.current = setTimeout(() => setDone(false), ms);
  }, [ms]);

  // Clear the pending reset if the component unmounts mid-flash.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return [done, flashDone];
}
