-- ============================================================================
-- AUTH/DATA INTEGRITY — normalize profiles.phone to E.164 + enforce uniqueness.
--
-- Audit findings (#1/#6/#8/#13):
--   * Legacy rows hold spaced/inconsistent formats like "+216 22 111 222".
--     Phone-only login (/api/auth/login-by-phone) validates the inbound number
--     as strict E.164 and does an EXACT `.eq('phone', ...)` lookup, so a spaced
--     stored value can never match → permanent lockout, and signup's
--     `phone_taken` pre-check misses the same row.
--   * profiles.phone had only a NON-unique partial index (0045), so two
--     accounts could share a phone; a duplicate makes login's `.maybeSingle()`
--     throw → silent lockout.
--
-- Normalizes existing phones to E.164, resolves duplicates, replaces the index
-- with a UNIQUE one. New signups already send normalized E.164 (client
-- normalizeE164 + the signup route validates it), so new rows stay clean.
-- Idempotent + safe on a fresh DB (no rows → no-ops).
--
-- NOTE: regexes use bracket classes ([0-9], [^0-9], [+]) rather than backslash
-- escapes (\d, \D, \+) on purpose — backslash escapes are brittle across
-- string-escaping layers and a stripped backslash turned ^\+ into ^+ (a
-- quantifier on an anchor) during the first apply.
-- ============================================================================

-- 1. Normalize any phone that contains separators (spaces/dashes/parens) to
--    E.164 = '+' followed by its digits — but ONLY when the cleaned result is
--    valid E.164. Already-clean rows and un-cleanable junk are left untouched.
update public.profiles
set phone = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone is not null
  and phone ~ '[^+0-9]'
  and ('+' || regexp_replace(phone, '[^0-9]', '', 'g')) ~ '^[+][0-9]{6,15}$';

-- 2. Resolve duplicate phones before the unique index: keep the earliest-created
--    profile, null the phone on the rest. Duplicates were already broken for
--    login-by-phone (maybeSingle() errors), so this only formalizes that. Rare;
--    defensive (expected to touch 0 rows in practice).
with ranked as (
  select id,
         row_number() over (partition by phone order by created_at asc, id asc) as rn
  from public.profiles
  where phone is not null
)
update public.profiles p
set phone = null
from ranked r
where p.id = r.id and r.rn > 1;

-- 3. Replace the non-unique partial index (0045) with a UNIQUE partial index.
--    Doubles as the login-by-phone lookup index, so no extra index is needed.
drop index if exists public.profiles_phone_idx;
create unique index if not exists profiles_phone_key
  on public.profiles (phone)
  where phone is not null;

notify pgrst, 'reload schema';
