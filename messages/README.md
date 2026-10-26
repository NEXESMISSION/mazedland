# Translations — French and Tunisian Arabic

`fr.json` is the source; `ar.json` must carry exactly the same keys with the same
placeholders. `pnpm i18n:check` fails otherwise, and also when the code asks for
a key that does not exist.

French is the default locale (`/fr`). Arabic is served at `/ar`, right-to-left.

## Arabic: which register

The site speaks **Tunisian** to Tunisians, without sounding unserious where trust
is at stake. Two registers, chosen by what the text is doing:

| Text | Register | Examples |
|---|---|---|
| Headlines, hero copy, calls to action, buttons, empty states, friendly toasts | **Tunisian Derja** (Arabic script) | لقى دارك بالسوم الحقيقي · حطّ إعلانك · شوف الرقم · لوّج · ما فماش إعلانات توّا |
| Form labels, field hints, validation errors, statuses, table headers, settings, payment instructions | **Simple Modern Standard Arabic** | رقم الهاتف · الولاية · السعر بالدينار · قيد المراجعة · كلمة السر |
| Legal text (terms, privacy), anything a seller could be held to | **Modern Standard Arabic**, plain and precise | شروط الاستعمال · سياسة الخصوصية |
| Admin console | Simple MSA labels; Derja only where the French is itself casual | لوحة الإدارة · قبول · رفض |

Never transliterate French into Arabic script when Tunisians write the French
word in Latin letters anyway (D17, RIB, IBAN, KYC stay Latin). Keep **Mazed Immo**
in Latin letters.

## Glossary

Use these, so the same thing is called the same everywhere.

| French | Arabic |
|---|---|
| annonce / annonces | إعلان / إعلانات |
| publier une annonce (CTA) | حطّ إعلانك |
| publication (the act, in forms) | نشر الإعلان |
| bien (immobilier) | عقار |
| vendeur · acheteur | البائع · الشاري |
| particulier · agence | خاص · وكالة عقارية |
| prix (labels) · prix (headlines) | السعر · السوم |
| TND · dinars | د.ت · دينار |
| surface · m² | المساحة · م² |
| gouvernorat · délégation | الولاية · المعتمدية |
| appartement · maison · villa | شقة · منزل · فيلا |
| terrain · ferme · local commercial | أرض · مزرعة · محل تجاري |
| bureau · dépôt / entrepôt | مكتب · مستودع |
| pièces · salles de bain · étage | الغرف · الحمّامات · الطابق |
| titre foncier | رسم عقاري |
| rechercher (button) · recherche (label) | لوّج · البحث |
| afficher le numéro | شوف الرقم |
| favoris | المفضّلة |
| mon compte · mes annonces | حسابي · إعلاناتي |
| se connecter · créer un compte · déconnexion | تسجيل الدخول · إنشاء حساب · خروج |
| mot de passe · code (OTP) | كلمة السر · رمز التحقق |
| paiement · virement bancaire · reçu | الدفع · تحويل بنكي · وصل الدفع |
| frais de publication | معلوم النشر |
| vendeur vérifié · badge | بائع موثّق · الشارة |
| brouillon | مسودة |
| à payer / paiement attendu | في انتظار الدفع |
| en vérification / à valider | قيد المراجعة |
| en ligne / publiée | منشور |
| refusée · expirée · archivée · vendue | مرفوض · منتهي الصلاحية · مؤرشف · مُباع |
| renouveler | جدّد |
| mise en avant | إبراز |
| notifications | الإشعارات |
| enregistrer · annuler · supprimer · modifier | سجّل · إلغاء · احذف · بدّل |

Category names come from the database (`categories.label_ar`) through
`categoryLabel()` — do not duplicate them in messages.

## How to write a message

- **One key per sentence, never concatenated.** `t("expiresIn", { days })`, not
  `"Expire dans " + days + " jours"`. Word order differs between the languages.
- **Plurals are ICU.** French needs `one`/`other`; Arabic has six forms:
  `{count, plural, zero {…} one {…} two {…} few {# …} many {# …} other {# …}}`.
  `few` is 3–10 (# إعلانات), `many` 11–99 (# إعلانًا), `other` 100+ (# إعلان).
  Never `n > 1 ? "s" : ""`.
- **Rich text** (a bold word, a link inside a sentence) uses `t.rich` with tags:
  `"Lisez les <terms>conditions</terms>"`.
- **Same placeholders in both files.** A French `{count}` must be `{count}` in
  Arabic.

## Formatting and direction

- **Numbers, prices, dates:** `formatTND(n, locale)`, `formatNumber(n, locale)`,
  `formatDate(d, locale, preset)`, `formatRelativeTime(d, locale)` from
  `@/lib/utils`. Never `toLocaleDateString("fr-FR")` or a hand-written
  "il y a …". `ar-TN` gives Latin digits and Tunisian month names.
- **Governorates** are stored in French; display with `governorateLabel(name,
  locale)` from `@/lib/tunisia`. Dial codes: `dialCodeLabel(c, locale)`.
- **Phone numbers, references (MZ-00042), IBAN/RIB/D17 numbers, codes like
  "S+3"** inside text: wrap in `<Ltr>` from `@/components/ui/Ltr` so their
  pieces do not reorder ("+216 98 124 111" would otherwise read "111 124 98 216+").
- **Prices are NOT wrapped.** Write number then currency ("500.000 د.ت") and let
  the bidi algorithm place them: an LTR box around the pair would put the
  currency on the wrong side for an Arabic reader.
- **Layout:** logical classes only — `ms-/me-`, `ps-/pe-`, `start-/end-`,
  `text-start/text-end`, `border-s/border-e`, `rounded-s/rounded-e`. A physical
  class (`ml-`, `left-`, `text-right`…) is a bug unless it is truly
  direction-free (centering, a symmetric decoration). `space-x-*` is fine: in
  Tailwind 4 it already uses logical margins.
- **No letter-spacing on Arabic.** It is a joined script; tracking pulls the
  letters apart. globals.css resets it on RTL pages for `tracking-*` utilities
  and the eyebrow / pill / heading classes — don't add letter-spacing that
  escapes that.
- **Icons that point** (ChevronRight/Left, ArrowRight/Left as "next", "back",
  "go"): add `rtl:-scale-x-100` so they flip. Do not flip icons that are not
  directional (search, close, plus, check, upload).
- **Sliders and swipes:** anything computing `translateX` or swipe direction
  must invert under RTL.
- **Locale in code:** `useLocale()` (client) / `getLocale()` (server);
  `isRtl(locale)` from `@/lib/i18n`. API routes that return a sentence the UI
  shows use `apiTranslator(req, "namespace")` from `@/lib/i18n/server`.
