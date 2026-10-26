-- ============================================================================
-- 0163 · Products speak Arabic too
--
-- A seller on /ar reads a product's name and description at publication, at
-- checkout and in their payments. `products.name_ar` has existed since 0148 but
-- every seed left it null, and there was no Arabic description at all.
--
-- Adds `description_ar` and fills both for the eight products the catalogue
-- was seeded with (0150), only where an admin has not already written one.
-- Products an admin creates later get their Arabic texts in /admin/offres; the
-- site falls back to the French ones until then.
--
-- Additive and idempotent: running it twice changes nothing.
-- ============================================================================

alter table public.products add column if not exists description_ar text;

update public.products p
   set name_ar        = coalesce(p.name_ar, v.name_ar),
       description_ar = coalesce(p.description_ar, v.description_ar),
       updated_at     = now()
  from (values
    ('annonce-standard',    'إعلان عادي',              'نشر عقار بسعر معلن لمدة 30 يومًا.'),
    ('renouvellement',      'تجديد',                   'يعيد نشر إعلان منتهي الصلاحية لمدة 30 يومًا.'),
    ('pack-5-annonces',     'باقة 5 إعلانات',          'خمس عمليات نشر تستعملها متى شئت، صالحة لمدة 12 شهرًا.'),
    ('pack-20-annonces',    'باقة 20 إعلانًا',          'عشرون عملية نشر للوكالات، صالحة لمدة 12 شهرًا.'),
    ('badge-verifie',       'شارة البائع الموثّق',      'يراجع فريقنا هويتك ووثائقك. تظهر الشارة على كل إعلاناتك لمدة 12 شهرًا.'),
    ('promo-accueil',       'إبراز · الصفحة الرئيسية',  'عقارك في شريط الصفحة الرئيسية.'),
    ('promo-top-recherche', 'في أعلى نتائج البحث',      'عقارك في مقدّمة نتائج فئته.'),
    ('promo-banniere',      'لافتة الصفحة الرئيسية',    'عقارك في لافتة على الصفحة الرئيسية.')
  ) as v(slug, name_ar, description_ar)
 where p.slug = v.slug
   and (p.name_ar is null or p.description_ar is null);
