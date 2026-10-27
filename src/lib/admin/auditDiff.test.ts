import { describe, expect, it } from "vitest";
import { auditChanges, auditValue } from "./auditDiff";
import { maskSecret } from "./audit";

describe("auditChanges", () => {
  it("keeps only the fields that moved", () => {
    expect(
      auditChanges({ role: "admin", admin_scopes: null }, { role: "admin", admin_scopes: ["paiements"] }),
    ).toEqual([{ key: "admin_scopes", from: null, to: ["paiements"] }]);
  });

  it("counts a field on one side only as changed", () => {
    expect(auditChanges(null, { quota: 5 })).toEqual([{ key: "quota", from: null, to: 5 }]);
    expect(auditChanges({ banned_at: "2026-10-27" }, {})).toEqual([{ key: "banned_at", from: "2026-10-27", to: null }]);
  });

  it("compares lists and objects by value", () => {
    expect(auditChanges({ s: ["a", "b"] }, { s: ["a", "b"] })).toEqual([]);
  });
});

describe("auditValue", () => {
  it("shows nothing as a dash, lists joined, booleans as marks", () => {
    expect(auditValue(null)).toBe("—");
    expect(auditValue([])).toBe("—");
    expect(auditValue(["annonces", "paiements"], (s) => s.toUpperCase())).toBe("ANNONCES, PAIEMENTS");
    expect(auditValue(true)).toBe("✓");
    expect(auditValue(120)).toBe("120");
  });
});

describe("maskSecret", () => {
  it("keeps the last four characters of a long bank detail, nothing of a short one", () => {
    expect(maskSecret("08006000123456789012")).toBe("••••9012");
    expect(maskSecret("12345")).toBe("••••");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(42)).toBe(42);
  });
});
