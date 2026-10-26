import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { ShopForm } from "@/components/pro/ShopForm";
import { getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

/** Open a shop (0173): the form, with the owner's phone and governorate already in. One shop per owner. */
export default async function CreateShopPage() {
  const locale = await getLocale();
  // New shops switched off in the console: back to the Pro page, which then
  // offers no way in. A shop that exists keeps its dashboard.
  if (!(await getSettings()).feature_pro_signup) redirect(`/${locale}/pro`);
  const t = await getTranslations("pro.create");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/pro/creer`)}`);

  const admin = getServiceSupabase();
  const db = admin ?? supabase;
  const [{ data: owned }, { data: profile }] = await Promise.all([
    db.from("shops").select("id").eq("owner_id", user!.id).limit(1),
    db.from("profiles").select("phone, governorate").eq("id", user!.id).maybeSingle(),
  ]);
  if (owned && owned.length > 0) redirect(`/${locale}/pro/dashboard?shop=${owned[0].id}`);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("subtitle")}</p>
      <div className="mt-6">
        <ShopForm
          mode="create"
          initial={{
            name: "",
            kind: "agency",
            description: "",
            governorate: (profile?.governorate as string | null) ?? "",
            city: "",
            phone: (profile?.phone as string | null) ?? "",
            email: "",
            website: "",
            hours: "",
            legal_name: "",
            legal_id: "",
            logo_path: null,
            cover_path: null,
          }}
        />
      </div>
    </main>
  );
}
