-- ============================================================================
-- 0169 · What the AI costs, call by call
--
-- Every request the site makes to the model (src/lib/ai) leaves one row: who
-- asked, for which feature, the model, the tokens it used and what that cost,
-- how long it took, whether it worked. The daily budget is enforced from these
-- rows — the assistant switches itself off for the rest of the day when the
-- sum reaches `ai_daily_budget_usd` — and the console reads them to say what
-- the AI costs and how often it fails (cahier des charges §12, §14).
--
-- Two settings: `ai_enabled` (the switch) and `ai_daily_budget_usd`.
-- Without an ANTHROPIC_API_KEY in the environment nothing calls the model,
-- whatever they say. Service role only. Idempotent.
-- ============================================================================

create table if not exists public.ai_calls (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete set null,
  feature            text not null,
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           numeric(10,6) not null default 0,
  latency_ms         integer,
  ok                 boolean not null,
  error              text,
  created_at         timestamptz not null default now()
);

create index if not exists ai_calls_created_idx on public.ai_calls (created_at desc);
create index if not exists ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

alter table public.ai_calls enable row level security;
revoke all on table public.ai_calls from anon, authenticated;

insert into public.app_settings (key, value, description)
values
  ('ai_enabled', 'true'::jsonb, 'Assistant IA (rédaction d''annonce) : interrupteur général. Sans clé ANTHROPIC_API_KEY il reste éteint.'),
  ('ai_daily_budget_usd', '2'::jsonb, 'Plafond de dépense IA par jour, en dollars. Atteint, l''assistant s''éteint jusqu''au lendemain.')
on conflict (key) do nothing;
