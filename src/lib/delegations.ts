/**
 * The 264 délégations (معتمديات) of Tunisia, by governorate.
 *
 * Like the governorates, the French name is the stored value
 * (`listings.delegation`, the catalogue's `del=` filter) and the Arabic one is
 * display only. Older annonces typed the délégation by hand (« Ennasr »,
 * « La marsa », « Route Teniour »): the lookups here match without accents or
 * case, and a value that is not on the list is shown as it was typed rather
 * than dropped.
 */
import { TUNISIAN_GOVERNORATES, type TunisianGovernorate } from "./tunisia";

type D = readonly [fr: string, ar: string];

export const DELEGATIONS: Record<TunisianGovernorate, readonly D[]> = {
  Tunis: [
    ["Bab Bhar", "باب البحر"], ["Bab Souika", "باب سويقة"], ["Carthage", "قرطاج"], ["Cité El Khadra", "حي الخضراء"],
    ["Djebel Jelloud", "جبل الجلود"], ["El Hrairia", "الحرايرية"], ["El Kabaria", "الكبارية"], ["El Menzah", "المنزه"],
    ["El Omrane", "العمران"], ["El Omrane Supérieur", "العمران الأعلى"], ["El Ouardia", "الوردية"], ["Ettahrir", "التحرير"],
    ["Ezzouhour", "الزهور"], ["La Goulette", "حلق الوادي"], ["La Marsa", "المرسى"], ["La Médina", "المدينة"],
    ["Le Bardo", "باردو"], ["Le Kram", "الكرم"], ["Séjoumi", "السيجومي"], ["Sidi El Béchir", "سيدي البشير"],
    ["Sidi Hassine", "سيدي حسين"],
  ],
  Ariana: [
    ["Ariana Ville", "أريانة المدينة"], ["Ettadhamen", "التضامن"], ["Kalâat el-Andalous", "قلعة الأندلس"], ["La Soukra", "سكرة"],
    ["Mnihla", "المنيهلة"], ["Raoued", "رواد"], ["Sidi Thabet", "سيدي ثابت"],
  ],
  "Ben Arous": [
    ["Ben Arous", "بن عروس"], ["Bou Mhel el-Bassatine", "بومهل البساتين"], ["El Mourouj", "المروج"], ["Ezzahra", "الزهراء"],
    ["Fouchana", "فوشانة"], ["Hammam Chott", "حمام الشط"], ["Hammam Lif", "حمام الأنف"], ["Mégrine", "مقرين"],
    ["Mohamedia", "المحمدية"], ["Mornag", "مرناق"], ["Nouvelle Médina", "المدينة الجديدة"], ["Radès", "رادس"],
  ],
  Manouba: [
    ["Borj El Amri", "برج العامري"], ["Djedeida", "الجديدة"], ["Douar Hicher", "دوار هيشر"], ["El Battan", "البطان"],
    ["La Manouba", "منوبة"], ["Mornaguia", "المرناقية"], ["Oued Ellil", "وادي الليل"], ["Tebourba", "طبربة"],
  ],
  Sousse: [
    ["Akouda", "أكودة"], ["Bouficha", "بوفيشة"], ["Enfidha", "النفيضة"], ["Hammam Sousse", "حمام سوسة"],
    ["Hergla", "هرقلة"], ["Kalâa Kebira", "القلعة الكبرى"], ["Kalâa Seghira", "القلعة الصغرى"], ["Kondar", "كندار"],
    ["M'saken", "مساكن"], ["Sidi Bou Ali", "سيدي بوعلي"], ["Sidi El Héni", "سيدي الهاني"], ["Sousse Jawhara", "سوسة جوهرة"],
    ["Sousse Médina", "سوسة المدينة"], ["Sousse Riadh", "سوسة الرياض"], ["Sousse Sidi Abdelhamid", "سوسة سيدي عبد الحميد"],
    ["Zaouiet Ksibet Thrayet", "الزاوية القصيبة الثريات"],
  ],
  Monastir: [
    ["Bekalta", "البقالطة"], ["Bembla", "بنبلة"], ["Beni Hassen", "بني حسان"], ["Jemmal", "جمال"],
    ["Ksar Hellal", "قصر هلال"], ["Ksibet el-Médiouni", "قصيبة المديوني"], ["Moknine", "المكنين"], ["Monastir", "المنستير"],
    ["Ouerdanine", "الوردانين"], ["Sahline", "الساحلين"], ["Sayada-Lamta-Bou Hajar", "صيادة لمطة بوحجر"], ["Téboulba", "طبلبة"],
    ["Zéramdine", "زرمدين"],
  ],
  Mahdia: [
    ["Bou Merdes", "بومرداس"], ["Chebba", "الشابة"], ["Chorbane", "شربان"], ["El Djem", "الجم"],
    ["Hebira", "هبيرة"], ["Ksour Essef", "قصور الساف"], ["Mahdia", "المهدية"], ["Melloulèche", "ملولش"],
    ["Ouled Chamekh", "أولاد الشامخ"], ["Sidi Alouane", "سيدي علوان"], ["Souassi", "السواسي"],
  ],
  Nabeul: [
    ["Béni Khalled", "بني خلاد"], ["Béni Khiar", "بني خيار"], ["Bou Argoub", "بوعرقوب"], ["Dar Chaâbane El Fehri", "دار شعبان الفهري"],
    ["El Haouaria", "الهوارية"], ["El Mida", "الميدة"], ["Grombalia", "قرمبالية"], ["Hammam Ghezèze", "حمام الغزاز"],
    ["Hammamet", "الحمامات"], ["Kélibia", "قليبية"], ["Korba", "قربة"], ["Menzel Bouzelfa", "منزل بوزلفة"],
    ["Menzel Temime", "منزل تميم"], ["Nabeul", "نابل"], ["Soliman", "سليمان"], ["Takelsa", "تاكلسة"],
  ],
  Sfax: [
    ["Agareb", "عقارب"], ["Bir Ali Ben Khalifa", "بئر علي بن خليفة"], ["El Amra", "العامرة"], ["El Hencha", "الحنشة"],
    ["Ghraïba", "الغريبة"], ["Jebiniana", "جبنيانة"], ["Kerkennah", "قرقنة"], ["Mahrès", "المحرس"],
    ["Menzel Chaker", "منزل شاكر"], ["Sakiet Eddaïer", "ساقية الدائر"], ["Sakiet Ezzit", "ساقية الزيت"], ["Sfax Ouest", "صفاقس الغربية"],
    ["Sfax Sud", "صفاقس الجنوبية"], ["Sfax Ville", "صفاقس المدينة"], ["Skhira", "الصخيرة"], ["Thyna", "طينة"],
  ],
  Bizerte: [
    ["Bizerte Nord", "بنزرت الشمالية"], ["Bizerte Sud", "بنزرت الجنوبية"], ["El Alia", "العالية"], ["Ghar El Melh", "غار الملح"],
    ["Ghezala", "غزالة"], ["Joumine", "جومين"], ["Mateur", "ماطر"], ["Menzel Bourguiba", "منزل بورقيبة"],
    ["Menzel Jemil", "منزل جميل"], ["Ras Jebel", "رأس الجبل"], ["Sejnane", "سجنان"], ["Tinja", "تينجة"],
    ["Utique", "أوتيك"], ["Zarzouna", "زرزونة"],
  ],
  Gabès: [
    ["El Hamma", "الحامة"], ["El Métouia", "المطوية"], ["Gabès Médina", "قابس المدينة"], ["Gabès Ouest", "قابس الغربية"],
    ["Gabès Sud", "قابس الجنوبية"], ["Ghannouch", "غنوش"], ["Mareth", "مارث"], ["Matmata", "مطماطة"],
    ["Menzel El Habib", "منزل الحبيب"], ["Nouvelle Matmata", "مطماطة الجديدة"],
  ],
  Médenine: [
    ["Ben Gardane", "بن قردان"], ["Beni Khedache", "بني خداش"], ["Djerba Ajim", "جربة أجيم"], ["Djerba Houmt Souk", "جربة حومة السوق"],
    ["Djerba Midoun", "جربة ميدون"], ["Médenine Nord", "مدنين الشمالية"], ["Médenine Sud", "مدنين الجنوبية"], ["Sidi Makhlouf", "سيدي مخلوف"],
    ["Zarzis", "جرجيس"],
  ],
  Kairouan: [
    ["Bou Hajla", "بوحجلة"], ["Chebika", "الشبيكة"], ["Chrarda", "الشراردة"], ["El Alâa", "العلا"],
    ["Haffouz", "حفوز"], ["Hajeb El Ayoun", "حاجب العيون"], ["Kairouan Nord", "القيروان الشمالية"], ["Kairouan Sud", "القيروان الجنوبية"],
    ["Nasrallah", "نصر الله"], ["Oueslatia", "الوسلاتية"], ["Sbikha", "السبيخة"],
  ],
  Béja: [
    ["Amdoun", "عمدون"], ["Béja Nord", "باجة الشمالية"], ["Béja Sud", "باجة الجنوبية"], ["Goubellat", "قبلاط"],
    ["Medjez el-Bab", "مجاز الباب"], ["Nefza", "نفزة"], ["Téboursouk", "تبرسق"], ["Testour", "تستور"],
    ["Tibar", "تيبار"],
  ],
  Jendouba: [
    ["Aïn Draham", "عين دراهم"], ["Balta-Bou Aouane", "بلطة بوعوان"], ["Bou Salem", "بوسالم"], ["Fernana", "فرنانة"],
    ["Ghardimaou", "غار الدماء"], ["Jendouba", "جندوبة"], ["Jendouba Nord", "جندوبة الشمالية"], ["Oued Meliz", "وادي مليز"],
    ["Tabarka", "طبرقة"],
  ],
  Kef: [
    ["Dahmani", "الدهماني"], ["Djerissa", "الجريصة"], ["El Ksour", "القصور"], ["Kalâat Khasba", "القلعة الخصباء"],
    ["Kalâat Senan", "قلعة سنان"], ["Kef Est", "الكاف الشرقية"], ["Kef Ouest", "الكاف الغربية"], ["Nebeur", "نبر"],
    ["Sakiet Sidi Youssef", "ساقية سيدي يوسف"], ["Sers", "السرس"], ["Tajerouine", "تاجروين"],
  ],
  Kasserine: [
    ["Djedeliane", "جدليان"], ["El Ayoun", "العيون"], ["Ezzouhour", "الزهور"], ["Fériana", "فريانة"],
    ["Foussana", "فوسانة"], ["Haïdra", "حيدرة"], ["Hassi El Ferid", "حاسي الفريد"], ["Kasserine Nord", "القصرين الشمالية"],
    ["Kasserine Sud", "القصرين الجنوبية"], ["Majel Bel Abbès", "ماجل بلعباس"], ["Sbeïtla", "سبيطلة"], ["Sbiba", "سبيبة"],
    ["Thala", "تالة"],
  ],
  "Sidi Bouzid": [
    ["Bir El Hafey", "بئر الحفي"], ["Cebbala Ouled Asker", "سبالة أولاد عسكر"], ["Jilma", "جلمة"], ["Meknassy", "المكناسي"],
    ["Menzel Bouzaiane", "منزل بوزيان"], ["Mezzouna", "المزونة"], ["Ouled Haffouz", "أولاد حفوز"], ["Regueb", "الرقاب"],
    ["Sidi Ali Ben Aoun", "سيدي علي بن عون"], ["Sidi Bouzid Est", "سيدي بوزيد الشرقية"], ["Sidi Bouzid Ouest", "سيدي بوزيد الغربية"], ["Souk Jedid", "السوق الجديد"],
  ],
  Gafsa: [
    ["Belkhir", "بلخير"], ["El Guettar", "القطار"], ["El Ksar", "القصر"], ["Gafsa Nord", "قفصة الشمالية"],
    ["Gafsa Sud", "قفصة الجنوبية"], ["Mdhilla", "المظيلة"], ["Métlaoui", "المتلوي"], ["Oum El Araïes", "أم العرائس"],
    ["Redeyef", "الرديف"], ["Sened", "السند"], ["Sidi Aïch", "سيدي عيش"],
  ],
  Tozeur: [
    ["Degache", "دقاش"], ["Hazoua", "حزوة"], ["Nefta", "نفطة"], ["Tameghza", "تمغزة"], ["Tozeur", "توزر"],
  ],
  Kebili: [
    ["Douz Nord", "دوز الشمالية"], ["Douz Sud", "دوز الجنوبية"], ["Faouar", "الفوار"], ["Kébili Nord", "قبلي الشمالية"],
    ["Kébili Sud", "قبلي الجنوبية"], ["Souk Lahad", "سوق الأحد"],
  ],
  Tataouine: [
    ["Bir Lahmar", "بئر الأحمر"], ["Dhehiba", "الذهيبة"], ["Ghomrassen", "غمراسن"], ["Remada", "رمادة"],
    ["Smâr", "الصمار"], ["Tataouine Nord", "تطاوين الشمالية"], ["Tataouine Sud", "تطاوين الجنوبية"],
  ],
  Siliana: [
    ["Bargou", "برقو"], ["Bou Arada", "بوعرادة"], ["Bourouis", "بورويس"], ["El Aroussa", "العروسة"],
    ["El Krib", "الكريب"], ["Gaâfour", "قعفور"], ["Kesra", "كسرى"], ["Makthar", "مكثر"],
    ["Rouhia", "الروحية"], ["Siliana Nord", "سليانة الشمالية"], ["Siliana Sud", "سليانة الجنوبية"],
  ],
  Zaghouan: [
    ["Bir Mcherga", "بئر مشارقة"], ["El Fahs", "الفحص"], ["Nadhour", "الناظور"], ["Saouaf", "صواف"],
    ["Zaghouan", "زغوان"], ["Zriba", "الزريبة"],
  ],
};

/** « La marsa », « LA MARSA », « La Marsa » and « la-marsa » are one place. */
export function placeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // « M'saken » and « Msaken »: an apostrophe is not a word break.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

const BY_KEY = new Map<string, { gov: TunisianGovernorate; fr: string; ar: string }>();
for (const gov of TUNISIAN_GOVERNORATES) {
  for (const [fr, ar] of DELEGATIONS[gov]) {
    // A name two governorates share (Ezzouhour: Tunis and Kasserine) keeps
    // the first; the Arabic label is the same either way.
    if (!BY_KEY.has(placeKey(fr))) BY_KEY.set(placeKey(fr), { gov, fr, ar });
    if (!BY_KEY.has(placeKey(ar))) BY_KEY.set(placeKey(ar), { gov, fr, ar });
  }
}

/** The délégations of a governorate, French names (the stored values), A→Z. */
export function delegationsOf(gov: string | null | undefined): string[] {
  const list = gov && (TUNISIAN_GOVERNORATES as readonly string[]).includes(gov) ? DELEGATIONS[gov as TunisianGovernorate] : [];
  return list.map(([fr]) => fr);
}

/** The listed délégation a typed name stands for, in its stored spelling, in this governorate. */
export function canonicalDelegation(gov: string | null | undefined, typed: string | null | undefined): string | null {
  if (!typed?.trim() || !gov) return null;
  const key = placeKey(typed);
  const found = (DELEGATIONS[gov as TunisianGovernorate] ?? []).find(([fr, ar]) => placeKey(fr) === key || placeKey(ar) === key);
  return found ? found[0] : null;
}

/** A délégation's name in the reader's language; one off the list as typed. */
export function delegationLabel(name: string | null | undefined, locale: string): string {
  if (!name) return "";
  const hit = BY_KEY.get(placeKey(name));
  if (!hit) return name;
  return locale === "ar" ? hit.ar : hit.fr;
}

/** The governorate a délégation belongs to, when it is on the list. */
export function governorateOfDelegation(name: string | null | undefined): TunisianGovernorate | null {
  return name ? (BY_KEY.get(placeKey(name))?.gov ?? null) : null;
}

/**
 * The délégation to show beside a place: a listed one of that governorate,
 * in the reader's language — or null. A name off the list is an old
 * free-text entry (« sfax », « alain »): shown beside the governorate it
 * only repeated it, or said a neighbourhood the quartier now carries.
 */
export function shownDelegation(gov: string | null | undefined, del: string | null | undefined, locale: string): string | null {
  const listed = canonicalDelegation(gov, del);
  return listed ? delegationLabel(listed, locale) : null;
}
