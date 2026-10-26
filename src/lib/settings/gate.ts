/**
 * The API side of a feature switch: a route whose feature an admin turned
 * off answers 403 `feature_off` — the page that would call it is hidden
 * too, so this only meets someone who kept a tab open, or a script.
 *
 *   const off = await featureOff("feature_visits");
 *   if (off) return off;
 */
import { NextResponse } from "next/server";
import { getSettings } from "./server";
import type { SettingKey } from "./registry";

type FeatureKey = Extract<SettingKey, `feature_${string}` | "social_enabled" | "ai_enabled">;

export async function featureOff(key: FeatureKey): Promise<NextResponse | null> {
  const s = await getSettings();
  return s[key] ? null : NextResponse.json({ error: "feature_off", feature: key }, { status: 403 });
}
