/**
 * Safely serialize an object for embedding inside
 * `<script type="application/ld+json" dangerouslySetInnerHTML=...>`.
 *
 * `JSON.stringify` does NOT escape `<`, `>`, or `&`. Seller-controlled fields
 * (a property `title` / `description`) flow into our JSON-LD, so a value like
 * `</script><script>alert(1)</script>` would survive `JSON.stringify` verbatim;
 * the browser's HTML parser then ends the script element at the literal
 * `</script>` and executes the injected tag — stored XSS running in every
 * visitor's authenticated session (CSP allows 'unsafe-inline', so there is no
 * second line of defense).
 *
 * Escaping `<` to its JSON unicode escape is the key fix (it breaks the
 * `</script>` byte sequence); `>` and `&` are escaped defensively. The result
 * is still valid JSON that `JSON.parse` decodes back to the identical object,
 * so the structured-data consumer (Google) is unaffected. (U+2028/U+2029 need
 * no escaping here: this is parsed as JSON, never evaluated as JavaScript.)
 */
export function jsonLdSafe(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
