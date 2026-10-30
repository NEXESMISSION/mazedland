/**
 * The JSON body of a request, as an object.
 *
 * `req.json().catch(() => ({}))` only covered a body that is not JSON. A body
 * that IS JSON but not an object — the literal `null`, a number, an array —
 * came back as is, and the first `body.field` threw: every money route
 * answered 500 to `null` (the QA tour, 2026-10-30). Anything that is not an
 * object reads as an empty one here, so the route refuses the missing fields
 * with its own 400.
 */
export async function jsonObject(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => null);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
