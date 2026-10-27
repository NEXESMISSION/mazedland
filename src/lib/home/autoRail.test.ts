import { describe, it, expect } from "vitest";
import {
  RESUME_AFTER_MS,
  arrowTarget,
  autoplayTarget,
  canPlay,
  cardIndexAt,
  logicalScroll,
  logicalStart,
  nextCardIndex,
  nextDelay,
  physicalScrollLeft,
  type RailPause,
} from "./autoRail";

// A phone rail: 230px cards, 12px gap, so a card every 242px; the first one
// sits at 0 once the scroll padding is taken off. Six cards in a 320px rail.
const STEP = 242;
const targets = [0, 1, 2, 3, 4, 5].map((i) => i * STEP);
const maxScroll = 1150;

describe("nextCardIndex", () => {
  it("moves one card on", () => {
    expect(nextCardIndex(0, 6, false)).toBe(1);
    expect(nextCardIndex(4, 6, false)).toBe(5);
  });

  it("goes back to the first card from the last, or from the end", () => {
    expect(nextCardIndex(5, 6, false)).toBe(0);
    expect(nextCardIndex(3, 6, true)).toBe(0);
    expect(nextCardIndex(0, 0, false)).toBe(0);
  });
});

describe("cardIndexAt", () => {
  it("is the last card the rail has reached, give or take snap's few pixels", () => {
    expect(cardIndexAt(targets, 0)).toBe(0);
    expect(cardIndexAt(targets, 100)).toBe(0);
    expect(cardIndexAt(targets, STEP - 2)).toBe(1);
    expect(cardIndexAt(targets, STEP * 2)).toBe(2);
  });
});

describe("autoplayTarget", () => {
  it("brings the next card to the start", () => {
    expect(autoplayTarget(targets, 0, maxScroll)).toBe(STEP);
    expect(autoplayTarget(targets, STEP, maxScroll)).toBe(STEP * 2);
    // Halfway through a hand scroll: on to the card after the one that is cut.
    expect(autoplayTarget(targets, STEP + 100, maxScroll)).toBe(STEP * 2);
  });

  it("stops at the end rather than past it, then loops back to the start", () => {
    expect(autoplayTarget(targets, STEP * 4, maxScroll)).toBe(maxScroll);
    expect(autoplayTarget(targets, maxScroll, maxScroll)).toBe(0);
    expect(autoplayTarget(targets, maxScroll - 2, maxScroll)).toBe(0);
  });

  it("does nothing when every card fits", () => {
    expect(autoplayTarget(targets, 0, 0)).toBeNull();
    expect(autoplayTarget([0], 0, 500)).toBeNull();
  });
});

describe("arrowTarget", () => {
  it("moves one card either way and stops at the ends", () => {
    expect(arrowTarget(targets, STEP, maxScroll, 1)).toBe(STEP * 2);
    expect(arrowTarget(targets, STEP, maxScroll, -1)).toBe(0);
    expect(arrowTarget(targets, 0, maxScroll, -1)).toBe(0);
    expect(arrowTarget(targets, maxScroll, maxScroll, 1)).toBe(maxScroll);
  });

  it("brings back a card that is cut before going further back", () => {
    expect(arrowTarget(targets, STEP + 100, maxScroll, -1)).toBe(STEP);
  });
});

describe("right-to-left scroll", () => {
  it("counts from the start in both directions", () => {
    expect(logicalScroll(300, false)).toBe(300);
    // An Arabic rail goes negative as it moves toward its end.
    expect(logicalScroll(-300, true)).toBe(300);
    expect(logicalScroll(0, true)).toBe(0);
  });

  it("hands scrollTo a negative scrollLeft in Arabic", () => {
    expect(physicalScrollLeft(300, false)).toBe(300);
    expect(physicalScrollLeft(300, true)).toBe(-300);
    expect(physicalScrollLeft(0, true)).toBe(0);
  });

  it("measures a card from the rail's leading edge", () => {
    const rail = { left: 0, right: 320 };
    // French: the second card's left edge, 258px in, with the rail at its start.
    expect(logicalStart({ left: 258, right: 488 }, rail, 0, false)).toBe(258);
    // Arabic: the same card is mirrored — its right edge is 258px from the rail's right.
    expect(logicalStart({ left: 320 - 488, right: 320 - 258 }, rail, 0, true)).toBe(258);
    // Scrolled 242px on, it sits 16px in, still 258px from the start.
    expect(logicalStart({ left: 16, right: 246 }, rail, 242, false)).toBe(258);
    expect(logicalStart({ left: 74, right: 304 }, rail, 242, true)).toBe(258);
  });

  it("round-trips to the same card in both directions", () => {
    for (const rtl of [false, true]) {
      const scroll = logicalScroll(physicalScrollLeft(STEP * 2, rtl), rtl);
      expect(autoplayTarget(targets, scroll, maxScroll)).toBe(STEP * 3);
    }
  });
});

describe("when a rail moves", () => {
  const still: RailPause = { hovering: false, touching: false, focused: false, inView: true, hidden: false };

  it("moves only when seen and left alone", () => {
    expect(canPlay(still)).toBe(true);
    for (const k of ["hovering", "touching", "focused", "hidden"] as const) {
      expect(canPlay({ ...still, [k]: true }), k).toBe(false);
    }
    expect(canPlay({ ...still, inView: false })).toBe(false);
  });

  it("waits a full interval, or longer after a swipe", () => {
    expect(nextDelay(1000, 5000, 0)).toBe(5000);
    expect(nextDelay(1000, 5000, 1000 + RESUME_AFTER_MS)).toBe(RESUME_AFTER_MS);
    expect(nextDelay(1000, 8000, 1000 + RESUME_AFTER_MS)).toBe(8000);
  });
});
