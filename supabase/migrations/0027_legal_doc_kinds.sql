-- ============================================================================
-- Batta.tn — Admin-controlled catalog of legal document kinds per property
-- type. Replaces the hardcoded DOC_KINDS array in src/components/sell/SellForm
-- with a database-backed list the admin can edit from /admin/legal-docs.
--
-- Why a separate catalog (not a column on property_documents):
--   - The seller needs to know *what to upload* BEFORE creating any docs, so
--     the form must fetch a list independent of any property row.
--   - The admin needs to mark some docs as required (block submission) and
--     adjust the list per property type without code changes.
--
-- property_documents.kind stays a free-text label snapshot of legal_doc_kinds.
-- label at upload time. We do NOT FK by id so renaming a kind label later
-- doesn't rewrite historical rows, and deleting a kind doesn't cascade-delete
-- already-uploaded docs.
-- ============================================================================

create table if not exists public.legal_doc_kinds (
  id            uuid primary key default gen_random_uuid(),
  property_type property_type not null,
  label         text not null check (length(label) between 1 and 80),
  description   text check (description is null or length(description) <= 240),
  required      boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (property_type, label)
);

create index if not exists legal_doc_kinds_type_sort_idx
  on public.legal_doc_kinds (property_type, sort_order, label);

-- updated_at maintained on write so the admin editor can show "last edited".
create or replace function public.tg_legal_doc_kinds_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tg_legal_doc_kinds_touch on public.legal_doc_kinds;
create trigger tg_legal_doc_kinds_touch
before update on public.legal_doc_kinds
for each row execute function public.tg_legal_doc_kinds_touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Read: anon + authenticated — sell form needs the catalog before sign-in
--       gates on KYC (it's not sensitive data, just a list of labels).
-- Write: admin only. Service role bypasses RLS for the API route's upserts.
alter table public.legal_doc_kinds enable row level security;

drop policy if exists legal_doc_kinds_read on public.legal_doc_kinds;
create policy legal_doc_kinds_read on public.legal_doc_kinds
for select using (true);

drop policy if exists legal_doc_kinds_admin_write on public.legal_doc_kinds;
create policy legal_doc_kinds_admin_write on public.legal_doc_kinds
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

grant select on public.legal_doc_kinds to anon, authenticated;
grant insert, update, delete on public.legal_doc_kinds to authenticated;

-- ─── Seed defaults ──────────────────────────────────────────────────────────
-- Carries forward the four DOC_KINDS from the old hardcoded picker, applied
-- per property type with sensible required flags. Admin can edit afterwards.
-- ON CONFLICT DO NOTHING so re-running the migration is idempotent.
insert into public.legal_doc_kinds (property_type, label, description, required, sort_order)
values
  -- Apartment / house / villa: built property, full paperwork set.
  ('apartment', 'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('apartment', 'Permis de bâtir',          'Délivré par la municipalité au moment de la construction.', false, 20),
  ('apartment', 'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('apartment', 'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  ('house',     'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('house',     'Permis de bâtir',          'Délivré par la municipalité au moment de la construction.', false, 20),
  ('house',     'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('house',     'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  ('villa',     'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('villa',     'Permis de bâtir',          'Délivré par la municipalité au moment de la construction.', false, 20),
  ('villa',     'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('villa',     'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  -- Land: no building permit. Plan de bornage instead.
  ('land',      'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('land',      'Plan de bornage',          'Levé topographique des limites de la parcelle.', false, 20),
  ('land',      'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('land',      'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  -- Commercial / office / warehouse: building + commercial paperwork.
  ('commercial', 'Titre foncier',           'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('commercial', 'Permis de bâtir',         'Délivré par la municipalité au moment de la construction.', false, 20),
  ('commercial', 'Registre de commerce',    'Pour fonds de commerce attaché au local.', false, 30),
  ('commercial', 'Quitus fiscal',           'Preuve que les impôts fonciers sont à jour.', false, 40),

  ('office',    'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('office',    'Permis de bâtir',          'Délivré par la municipalité au moment de la construction.', false, 20),
  ('office',    'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('office',    'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  ('warehouse', 'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('warehouse', 'Permis de bâtir',          'Délivré par la municipalité au moment de la construction.', false, 20),
  ('warehouse', 'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('warehouse', 'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40),

  -- Farm: bornage + agricultural specifics.
  ('farm',      'Titre foncier',            'Le document de propriété officiel (rsm 3aqari).', true,  10),
  ('farm',      'Plan de bornage',          'Levé topographique des limites de la parcelle.', false, 20),
  ('farm',      'Certificat de propriété',  'Extrait récent de la conservation foncière.', false, 30),
  ('farm',      'Quitus fiscal',            'Preuve que les impôts fonciers sont à jour.', false, 40)
on conflict (property_type, label) do nothing;

notify pgrst, 'reload schema';
