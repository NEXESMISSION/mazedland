-- ============================================================================
-- Batta.tn — Per-type characteristics: clearer names + essential additions
--
-- Refines the catalog seeded in 0037. Two kinds of change:
--   1. Clearer labels (e.g. "Surface" → "Surface habitable" / "Surface bâtie"
--      / "Superficie" by type; "Pièces" → "Chambres" for homes; "Type de
--      titre" → "Titre foncier"; office "Salles de bain" → "Sanitaires").
--   2. The few essential fields that were missing per type (commercial
--      sanitaires, office parking, warehouse triphasé, farm électricité).
--
-- Applied as an UPSERT: existing rows (matched on property_type+field_key)
-- get their label/widget/order refreshed; genuinely new fields are inserted.
-- field_key is the stable storage key inside properties.attributes, so
-- relabelling never orphans values already saved by sellers.
--
-- Admins can still tune everything afterwards in /admin/characteristics.
-- ============================================================================

insert into public.property_attribute_kinds
  (property_type, field_key, label, data_type, options, unit, required, sort_order)
values
  -- ── Appartement ────────────────────────────────────────────────────────
  ('apartment', 'area_sqm',     'Surface habitable',     'number',  null, 'm²', true,  10),
  ('apartment', 'rooms',        'Chambres',              'number',  null, null, false, 20),
  ('apartment', 'bathrooms',    'Salles de bain',        'number',  null, null, false, 30),
  ('apartment', 'floor',        'Étage',                 'number',  null, null, false, 40),
  ('apartment', 'year_built',   'Année de construction', 'number',  null, null, false, 50),
  ('apartment', 'has_elevator', 'Ascenseur',             'boolean', null, null, false, 60),
  ('apartment', 'parking',      'Parking',               'boolean', null, null, false, 70),
  ('apartment', 'furnished',    'Meublé',                'boolean', null, null, false, 80),

  -- ── Maison ─────────────────────────────────────────────────────────────
  ('house', 'area_sqm',      'Surface bâtie',         'number',  null, 'm²', true,  10),
  ('house', 'land_area_sqm', 'Surface du terrain',    'number',  null, 'm²', false, 20),
  ('house', 'rooms',         'Chambres',              'number',  null, null, false, 30),
  ('house', 'bathrooms',     'Salles de bain',        'number',  null, null, false, 40),
  ('house', 'year_built',    'Année de construction', 'number',  null, null, false, 50),
  ('house', 'garden',        'Jardin',                'boolean', null, null, false, 60),
  ('house', 'garage',        'Garage',                'boolean', null, null, false, 70),

  -- ── Villa ──────────────────────────────────────────────────────────────
  ('villa', 'area_sqm',      'Surface bâtie',         'number',  null, 'm²', true,  10),
  ('villa', 'land_area_sqm', 'Surface du terrain',    'number',  null, 'm²', false, 20),
  ('villa', 'rooms',         'Chambres',              'number',  null, null, false, 30),
  ('villa', 'bathrooms',     'Salles de bain',        'number',  null, null, false, 40),
  ('villa', 'year_built',    'Année de construction', 'number',  null, null, false, 50),
  ('villa', 'pool',          'Piscine',               'boolean', null, null, false, 60),
  ('villa', 'garden',        'Jardin',                'boolean', null, null, false, 70),
  ('villa', 'garage',        'Garage',                'boolean', null, null, false, 80),

  -- ── Terrain ────────────────────────────────────────────────────────────
  ('land', 'area_sqm',     'Surface',      'number', null, 'm²', true, 10),
  ('land', 'title_type',   'Titre foncier', 'select',
     '[{"value":"titre_bleu","label":"Titre bleu"},{"value":"titre_vert","label":"Titre vert"},{"value":"non_immatricule","label":"Non immatriculé"}]'::jsonb,
     null, false, 20),
  ('land', 'constructible', 'Constructible',               'boolean', null, null, false, 30),
  ('land', 'frontage_m',    'Façade',                      'number',  null, 'm',  false, 40),
  ('land', 'serviced',      'Viabilisé (eau/électricité)', 'boolean', null, null, false, 50),

  -- ── Local commercial ───────────────────────────────────────────────────
  ('commercial', 'area_sqm',   'Surface',               'number',  null, 'm²', true,  10),
  ('commercial', 'frontage_m', 'Façade',                'number',  null, 'm',  false, 20),
  ('commercial', 'floor',      'Étage',                 'number',  null, null, false, 30),
  ('commercial', 'shopfront',  'Vitrine',               'boolean', null, null, false, 40),
  ('commercial', 'parking',    'Parking',               'boolean', null, null, false, 50),
  ('commercial', 'restroom',   'Sanitaires',            'boolean', null, null, false, 60),
  ('commercial', 'year_built', 'Année de construction', 'number',  null, null, false, 70),

  -- ── Bureau ─────────────────────────────────────────────────────────────
  ('office', 'area_sqm',         'Surface',               'number',  null, 'm²', true,  10),
  ('office', 'rooms',            'Pièces',                'number',  null, null, false, 20),
  ('office', 'bathrooms',        'Sanitaires',            'number',  null, null, false, 30),
  ('office', 'floor',            'Étage',                 'number',  null, null, false, 40),
  ('office', 'has_elevator',     'Ascenseur',             'boolean', null, null, false, 50),
  ('office', 'air_conditioning', 'Climatisation',         'boolean', null, null, false, 60),
  ('office', 'parking',          'Parking',               'boolean', null, null, false, 70),
  ('office', 'year_built',       'Année de construction', 'number',  null, null, false, 80),

  -- ── Entrepôt ───────────────────────────────────────────────────────────
  ('warehouse', 'area_sqm',         'Surface',                  'number',  null, 'm²', true,  10),
  ('warehouse', 'ceiling_height_m', 'Hauteur sous plafond',     'number',  null, 'm',  false, 20),
  ('warehouse', 'loading_docks',    'Quais de chargement',      'number',  null, null, false, 30),
  ('warehouse', 'three_phase',      'Force motrice (triphasé)', 'boolean', null, null, false, 40),
  ('warehouse', 'truck_access',     'Accès poids lourd',        'boolean', null, null, false, 50),
  ('warehouse', 'year_built',       'Année de construction',    'number',  null, null, false, 60),

  -- ── Ferme ──────────────────────────────────────────────────────────────
  ('farm', 'area_sqm',     'Superficie',          'number', null, 'ha', true,  10),
  ('farm', 'water_source', 'Source d''eau', 'select',
     '[{"value":"puits","label":"Puits"},{"value":"forage","label":"Forage"},{"value":"sonede","label":"SONEDE"},{"value":"aucune","label":"Aucune"}]'::jsonb,
     null, false, 20),
  ('farm', 'soil_type',    'Type de sol',        'text',    null, null, false, 30),
  ('farm', 'electricity',  'Électricité (STEG)', 'boolean', null, null, false, 40),
  ('farm', 'buildings',    'Bâtiments',          'boolean', null, null, false, 50)
on conflict (property_type, field_key) do update set
  label      = excluded.label,
  data_type  = excluded.data_type,
  options    = excluded.options,
  unit       = excluded.unit,
  required   = excluded.required,
  sort_order = excluded.sort_order;
