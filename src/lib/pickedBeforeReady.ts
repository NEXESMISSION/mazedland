/**
 * `ref={pickedBeforeReady}` on a file input inside a <label>: a file chosen
 * before the page's JavaScript was running is sent now instead of being lost.
 *
 * A label opens the phone's picker natively, before React has started. The
 * file lands in the input, but its « change » fired with nobody listening, so
 * nothing was sent and the person had to choose it a second time — « the
 * receipt never goes through the first time » (2026-10-28). React attaches
 * the ref when it takes over the input; if a file is already there, the
 * change event is fired again, now with the page's handler listening.
 *
 * Handlers must clear `e.target.value` once they have the file, so a change
 * React itself replayed and this one never send it twice.
 */
export function pickedBeforeReady(el: HTMLInputElement | null): void {
  if (!el || !el.files || el.files.length === 0) return;
  // After the commit that attached the ref: the listeners and state are ready.
  setTimeout(() => {
    if (el.isConnected && el.files && el.files.length > 0) {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, 0);
}
