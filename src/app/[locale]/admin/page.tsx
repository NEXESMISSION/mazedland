import { redirect } from "@/i18n/navigation";

/**
 * The admin home is the Properties hub — it carries the cross-queue
 * "Action requise" summary plus the consignment queue, so there's no
 * separate Overview page anymore.
 */
export default async function AdminHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/admin/properties", locale: locale as "ar" | "fr" | "en" });
}
