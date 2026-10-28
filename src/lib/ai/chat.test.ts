import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LISTING_CHAT_SCHEMA,
  LISTING_DRAFT_SCHEMA,
  buildChatSystemPrompt,
  chatReply,
  chatTranscript,
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

  it("can be switched off, or made the way in, from the console", () => {
    expect(SETTINGS.feature_publish_chat).toMatchObject({ type: "bool", default: true, client: true });
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
