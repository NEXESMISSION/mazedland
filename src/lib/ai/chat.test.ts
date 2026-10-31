import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_TURN_CHARS,
  LISTING_CHAT_SCHEMA,
  LISTING_DRAFT_SCHEMA,
  buildChatSystemPrompt,
  chatReply,
  chatTranscript,
  splitTurn,
} from "./listing";
import { SETTINGS } from "@/lib/settings/registry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("publish by talking (version B)", () => {
  it("asks the model for the whole annonce, what to say next, and whether to publish", () => {
    for (const k of LISTING_DRAFT_SCHEMA.required) expect(LISTING_CHAT_SCHEMA.required).toContain(k);
    expect(LISTING_CHAT_SCHEMA.required).toEqual(expect.arrayContaining(["reply", "wants_to_publish"]));
    expect(LISTING_CHAT_SCHEMA.properties.wants_to_publish).toEqual({ type: "boolean" });
  });

  it("reads the conversation in order, later words correcting earlier ones", () => {
    const p = buildChatSystemPrompt([]);
    expect(p).toContain("A later message corrects an earlier one");
    expect(p).toContain("انشر");
    expect(p).toContain("publish");
    expect(chatTranscript([
      { role: "assistant", text: "Bonjour !" },
      { role: "seller", text: "Villa à Hammamet" },
    ])).toBe("You: Bonjour !\nSeller: Villa à Hammamet");
  });

  it("keeps the reply short and never repeats a phone number", () => {
    expect(chatReply({ reply: "  C'est noté.\n Quel est le prix ?  ", wants_to_publish: true })).toEqual({
      reply: "C'est noté. Quel est le prix ?",
      wantsToPublish: true,
    });
    expect(chatReply({ reply: "Appelez le 98 123 456", wants_to_publish: false }).reply).toBe("");
    expect(chatReply(null)).toEqual({ reply: "", wantsToPublish: false });
    expect(chatReply({ reply: "x".repeat(900) }).reply).toHaveLength(400);
  });

  it("reads a long dictation whole, as several turns cut at sentence ends", () => {
    const sentence = "عندي دار في صفاقس طريق قرمدة مساحتها 180 متر فيها 3 بيوت. ";
    const said = `${sentence.repeat(30)}السوم 350 مليون. انشر`;
    const parts = splitTurn(said);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHAT_MAX_TURN_CHARS);
    // Nothing lost, nothing cut inside a sentence, the price and « انشر » last.
    expect(parts.join(" ")).toBe(said);
    for (const p of parts.slice(0, -1)) expect(p.endsWith(".")).toBe(true);
    expect(parts[parts.length - 1]).toMatch(/انشر$/);
  });

  it("cuts at a space when there is no sentence end, and only hard where there is neither", () => {
    const words = "mot ".repeat(500).trim();
    for (const p of splitTurn(words)) {
      expect(p.length).toBeLessThanOrEqual(CHAT_MAX_TURN_CHARS);
      expect(p.startsWith("mot")).toBe(true);
      expect(p.endsWith("mot")).toBe(true);
    }
    expect(splitTurn("x".repeat(1700), 800).map((p) => p.length)).toEqual([800, 800, 100]);
    expect(splitTurn("  court  ")).toEqual(["court"]);
    expect(splitTurn("")).toEqual([]);
  });

  it("stops the microphone at a few turns, never at one", () => {
    expect(CHAT_MAX_MESSAGE_CHARS).toBeGreaterThanOrEqual(3 * CHAT_MAX_TURN_CHARS);
    expect(CHAT_MAX_MESSAGE_CHARS % CHAT_MAX_TURN_CHARS).toBe(0);
  });

  it("can be switched on, or made the way in, from the console", () => {
    // Off until the owner turns it on (asked 2026-10-31).
    expect(SETTINGS.feature_publish_chat).toMatchObject({ type: "bool", default: false, client: true });
    expect(SETTINGS.publish_chat_default).toMatchObject({ type: "bool", default: false });
  });

  it("is one tap from the form, and the form one tap from it", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/ai/listing-chat/route.ts"))).toBe(true);
    expect(read("src/app/[locale]/annonces/nouvelle/PublishWizard.tsx")).toContain('"/annonces/nouvelle/parler"');
    expect(read("src/app/[locale]/annonces/nouvelle/parler/ChatPublisher.tsx")).toContain('"/annonces/nouvelle?forme=1"');
  });

  it("publishes through the form's own routes, so places and moderation apply the same", () => {
    const src = read("src/app/[locale]/annonces/nouvelle/parler/ChatPublisher.tsx");
    expect(src).toContain('fetch("/api/annonces"');
    expect(src).toContain("/submit`");
    expect(src).toContain('"free_limit_reached"');
  });
});
