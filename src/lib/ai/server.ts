import Anthropic from "@anthropic-ai/sdk";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * The one door to the model (cahier des charges §14).
 *
 * Off unless three things hold: an ANTHROPIC_API_KEY in the environment, the
 * `ai_enabled` setting, and today's spend under `ai_daily_budget_usd` (0169) —
 * and, for the account asking, under `ai_user_daily_budget_usd`, so that one
 * account cannot use the whole day's budget. Every call — answered or failed
 * — leaves an `ai_calls` row with its tokens and cost, which is what the
 * budget sums. A caller that gets `ok: false` carries on without the AI:
 * every feature built on this has a form under it.
 */

export const AI_MODEL = "claude-opus-5-5";

/** USD per million tokens (Anthropic price list, as of 2026-10-06). A request
 *  served by a fallback model is priced at that model's rates. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

const TZ_OFFSET_MS = 3_600_000; // Tunisia is UTC+1 all year.

export function hasAiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function aiSettings(admin: Admin): Promise<{ enabled: boolean; dailyBudgetUsd: number; userDailyBudgetUsd: number }> {
  const s = await loadSettings(admin);
  return { enabled: s.ai_enabled, dailyBudgetUsd: s.ai_daily_budget_usd, userDailyBudgetUsd: s.ai_user_daily_budget_usd };
}

/** What the AI has cost since midnight in Tunis — for everybody, or for one account. */
export async function spentTodayUsd(admin: Admin, userId?: string): Promise<number> {
  const tunis = new Date(Date.now() + TZ_OFFSET_MS);
  const midnight = new Date(Date.UTC(tunis.getUTCFullYear(), tunis.getUTCMonth(), tunis.getUTCDate()) - TZ_OFFSET_MS);
  let q = admin.from("ai_calls").select("cost_usd").gte("created_at", midnight.toISOString());
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  return (data ?? []).reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
}

/** Whether a feature may offer the AI right now (the key, the switch, the budget). */
export async function aiAvailable(admin: Admin): Promise<boolean> {
  if (!hasAiKey()) return false;
  const s = await aiSettings(admin);
  if (!s.enabled) return false;
  return (await spentTodayUsd(admin)) < s.dailyBudgetUsd;
}

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES[AI_MODEL];
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

/**
 * What a call will cost before it is made: the text in at about two
 * characters a token (measured on Derja and French), a short structured
 * answer out, at the model's plain rates — the cached system prompt costs
 * less, so this errs on the high side.
 */
export function estimateCostUsd(model: string, inputChars: number, outputTokens = 400): number {
  const p = PRICES[model] ?? PRICES[AI_MODEL];
  return ((inputChars / 2) * p.input + outputTokens * p.output) / 1_000_000;
}

/**
 * One structured-output request: `system` (cached — it is the same long text
 * on every call), the user's text, and a JSON schema the answer must follow.
 * Returns the parsed JSON, or why there is none.
 */
export async function callJson(opts: {
  admin: Admin;
  userId: string | null;
  feature: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<{ ok: true; data: unknown } | { ok: false; reason: "unavailable" | "refused" | "failed" }> {
  if (!hasAiKey()) return { ok: false, reason: "unavailable" };
  const s = await aiSettings(opts.admin);
  if (!s.enabled) return { ok: false, reason: "unavailable" };

  // The budget is charged before the call, not after it. The row is written
  // first, with the estimated cost, and only then is today's sum read — this
  // reservation and every other one in flight included — so two bursts at
  // the same moment cannot both pass a gate read before either was counted
  // (the QA tour measured 6 s between the gate and the charge). The row takes
  // the real figures once the answer is in; refused, it is removed.
  const started = Date.now();
  const estimate = estimateCostUsd(AI_MODEL, opts.system.length + opts.user.length);
  const { data: reserved } = await opts.admin
    .from("ai_calls")
    .insert({ user_id: opts.userId, feature: opts.feature, model: AI_MODEL, cost_usd: estimate, ok: false, error: "pending" })
    .select("id")
    .single();
  const reservation = (reserved as { id?: string } | null)?.id ?? null;
  const [spent, mine] = await Promise.all([
    spentTodayUsd(opts.admin),
    opts.userId ? spentTodayUsd(opts.admin, opts.userId) : Promise.resolve(0),
  ]);
  // Without a row of its own (the insert failed), the call still counts.
  const unreserved = reservation ? 0 : estimate;
  if (spent + unreserved > s.dailyBudgetUsd || (opts.userId && mine + unreserved > s.userDailyBudgetUsd)) {
    if (reservation) await opts.admin.from("ai_calls").delete().eq("id", reservation);
    return { ok: false, reason: "unavailable" };
  }

  const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
  const settle = (row: { model: string; usage?: Usage; ok: boolean; error?: string }) => {
    const values = {
      model: row.model,
      input_tokens: row.usage?.input_tokens ?? 0,
      output_tokens: row.usage?.output_tokens ?? 0,
      cache_read_tokens: row.usage?.cache_read_input_tokens ?? 0,
      cache_write_tokens: row.usage?.cache_creation_input_tokens ?? 0,
      cost_usd: row.usage ? costOf(row.model, row.usage) : 0,
      latency_ms: Date.now() - started,
      ok: row.ok,
      error: row.error ?? null,
    };
    const write = reservation
      ? opts.admin.from("ai_calls").update(values).eq("id", reservation)
      : opts.admin.from("ai_calls").insert({ user_id: opts.userId, feature: opts.feature, ...values });
    return write.then(() => {}, () => {});
  };

  try {
    const res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 4_000,
      // A classifier decline is re-run on the model Anthropic recommends for
      // its category instead of coming back empty.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Reading a sentence into fields: low effort holds the quality and the cost.
      output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
    });

    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      await settle({ model: res.model, usage: res.usage, ok: false, error: res.stop_reason });
      return { ok: false, reason: res.stop_reason === "refusal" ? "refused" : "failed" };
    }
    const block = res.content.find((b) => b.type === "text");
    const data = block && block.type === "text" ? JSON.parse(block.text) : null;
    await settle({ model: res.model, usage: res.usage, ok: data !== null, error: data === null ? "no_text" : undefined });
    return data === null ? { ok: false, reason: "failed" } : { ok: true, data };
  } catch (e) {
    const error =
      e instanceof Anthropic.APIError ? `api_${e.status ?? "error"}` : e instanceof SyntaxError ? "bad_json" : "network";
    await settle({ model: AI_MODEL, ok: false, error });
    return { ok: false, reason: "failed" };
  }
}
