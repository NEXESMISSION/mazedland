/**
 * Photos still on their way, counted per listener — and outliving the
 * uploader that started them.
 *
 * The publish form lets the seller move on while photos upload (PublishWizard:
 * « Continuer » never waits for them), and the chat publisher has two
 * uploaders, one in the photo box and one on the last step. The uploader on
 * screen is unmounted when the step changes or the box closes, but its photos
 * keep going and still join the annonce. Counted in the component's own state,
 * they were lost at that moment: the last number it had reported stayed with
 * the form for good, and « Publier » waited for uploads that had long
 * finished, spinning until the page was reloaded.
 *
 * So the count lives here, keyed by the form's setter. Every uploader that
 * reports to the same setter adds to one set, and a photo leaves it when its
 * send settles, whether its uploader is still on screen or not.
 */
type Listener = (count: number) => void;

const inFlight = new WeakMap<Listener, Set<string>>();

/** A photo starts: the listener hears the new total. */
export function trackUpload(listener: Listener | undefined, id: string): void {
  if (!listener) return;
  let set = inFlight.get(listener);
  if (!set) {
    set = new Set();
    inFlight.set(listener, set);
  }
  if (set.has(id)) return;
  set.add(id);
  listener(set.size);
}

/** A photo landed, failed or was dropped: the listener hears the new total. */
export function settleUpload(listener: Listener | undefined, id: string): void {
  if (!listener) return;
  const set = inFlight.get(listener);
  if (!set || !set.delete(id)) return;
  listener(set.size);
}

/** How many photos the listener is still waiting for. */
export function uploadsInFlight(listener: Listener): number {
  return inFlight.get(listener)?.size ?? 0;
}
