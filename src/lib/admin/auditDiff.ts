/**
 * What an audit entry changed, field by field, for the journal on
 * /admin/equipe: only the fields whose value moved, in the order they first
 * appear. A field present on one side only counts as changed (from or to
 * nothing).
 */
export type AuditChange = { key: string; from: unknown; to: unknown };

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const b = asObject(before);
  const a = asObject(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => !same(b[k], a[k])).map((k) => ({ key: k, from: b[k] ?? null, to: a[k] ?? null }));
}

/** One value as the journal shows it: words through `label`, lists joined, nothing as « — ». */
export function auditValue(v: unknown, label: (s: string) => string = (s) => s): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => label(String(x))).join(", ") : "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return label(v);
  return String(v);
}
