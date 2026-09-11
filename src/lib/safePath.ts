/**
 * Accept a user-supplied redirect target only if it stays on this site.
 *
 * `path.startsWith("/")` is the check everyone writes and it is not enough:
 * `//evil.example` starts with a slash and the browser reads it as a
 * PROTOCOL-RELATIVE URL — a different origin. `/\\evil.example` does the same
 * in several browsers, which normalise the backslash to a slash. Both turn a
 * "return to where you were" parameter into an open redirect, and on a page
 * that auto-navigates (payment success does, after 1.8 s) the victim never even
 * clicks.
 *
 * Returns the path when it is a same-site absolute path, otherwise `fallback`.
 */
export function safeInternalPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const p = raw.trim();
  if (!p.startsWith("/")) return fallback;
  if (p.startsWith("//") || p.startsWith("/\\")) return fallback;
  // Control characters (tab, newline) are stripped by URL parsers and can
  // smuggle a second slash past the check above.
  if (/[\u0000-\u001f\u007f]/.test(p)) return fallback;
  return p;
}
