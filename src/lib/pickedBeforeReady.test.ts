import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickedBeforeReady } from "./pickedBeforeReady";

const input = (files: number, connected = true) => {
  const dispatchEvent = vi.fn();
  return { el: { files: { length: files }, isConnected: connected, dispatchEvent } as unknown as HTMLInputElement, dispatchEvent };
};

describe("a file chosen before the page was ready", () => {
  afterEach(() => vi.useRealTimers());

  it("is handed to the page's handler once React takes over the input", () => {
    vi.useFakeTimers();
    const { el, dispatchEvent } = input(1);
    pickedBeforeReady(el);
    expect(dispatchEvent).not.toHaveBeenCalled(); // not during React's commit
    vi.runAllTimers();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe("change");
    expect((dispatchEvent.mock.calls[0][0] as Event).bubbles).toBe(true);
  });

  it("does nothing for an empty input, a detached one, or none", () => {
    vi.useFakeTimers();
    const empty = input(0);
    const gone = input(1, false);
    pickedBeforeReady(empty.el);
    pickedBeforeReady(gone.el);
    pickedBeforeReady(null);
    vi.runAllTimers();
    expect(empty.dispatchEvent).not.toHaveBeenCalled();
    expect(gone.dispatchEvent).not.toHaveBeenCalled();
  });

  it("is on every file field a <label> opens, and each handler clears its input (never sent twice)", () => {
    for (const f of [
      "src/app/[locale]/payment/checkout/CheckoutClient.tsx",
      "src/app/[locale]/pro/dashboard/ProActions.tsx",
      "src/components/pro/ShopForm.tsx",
      "src/app/[locale]/pro/dashboard/ProjectsPanel.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toContain("pickedBeforeReady");
      expect(/e\.target\.value = ""|fileInputRef\.current\) fileInputRef\.current\.value = ""/.test(src), f).toBe(true);
    }
  });
});
