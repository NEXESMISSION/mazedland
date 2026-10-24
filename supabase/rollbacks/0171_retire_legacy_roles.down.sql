-- Rollback of 0171: give the six seed accounts back the roles they had on
-- 2026-10-24 (read from the live database just before 0171 ran).
select set_config('app.bypass_profile_guard', 'on', true);

update public.profiles as p
   set role = v.role::public.user_role
  from (values
    ('0a5f6777-c4b9-4bd9-82a1-71e763c9d294'::uuid, 'bank'),       -- stb@mazedimmo.test
    ('d4473900-ed2d-45fb-95f0-aa836ca98ac4'::uuid, 'bailiff'),    -- bailiff@mazedimmo.test
    ('3d8936a7-790e-4751-9d46-adfce2c0f663'::uuid, 'inspector'),  -- insp.tunis@mazedimmo.test
    ('0a4e8f1c-c4df-4130-bc59-e618a39b624c'::uuid, 'inspector'),  -- insp.sousse@mazedimmo.test
    ('52ea5561-7cf4-432b-aa71-987918a786f7'::uuid, 'inspector'),  -- insp.nabeul@mazedimmo.test
    ('0564fb53-8301-48ef-9ca9-ecb7b664ac88'::uuid, 'inspector')   -- insp.sfax@mazedimmo.test
  ) as v(id, role)
 where p.id = v.id and p.role = 'individual';
