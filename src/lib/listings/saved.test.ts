import { describe, it, expect } from "vitest";
import { savedVisibility } from "./saved";

const once = "2026-10-01T10:00:00Z";

describe("savedVisibility", () => {
  it("shows what is online, and what the seller took down or sold, with its words", () => {
    expect(savedVisibility({ status: "published", published_at: once, taken_down_at: null })).toBe("shown");
    // Withdrawn by the seller: archived, but not taken down.
    expect(savedVisibility({ status: "archived", published_at: once, taken_down_at: null })).toBe("shown");
    expect(savedVisibility({ status: "sold", published_at: once, taken_down_at: null })).toBe("shown");
    expect(savedVisibility({ status: "expired", published_at: once, taken_down_at: null })).toBe("shown");
    // Held offline for the seller's edit: it was public, and it comes back.
    expect(savedVisibility({ status: "pending_review", published_at: once, taken_down_at: null })).toBe("shown");
  });

  it("keeps a taken-down annonce in the list without its content", () => {
    expect(savedVisibility({ status: "archived", published_at: once, taken_down_at: once })).toBe("withheld");
  });

  it("drops what was never public", () => {
    expect(savedVisibility({ status: "draft", published_at: null, taken_down_at: null })).toBe("dropped");
    expect(savedVisibility({ status: "pending_review", published_at: null, taken_down_at: null })).toBe("dropped");
    expect(savedVisibility({ status: "rejected", published_at: null, taken_down_at: null })).toBe("dropped");
  });
});
