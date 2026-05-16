import { redirect } from "@/i18n/navigation";

/**
 * KYC entry point. Always routes to /kyc/start so the wizard's
 * intro screen handles the "have I started yet?" branching. Direct
 * links to /kyc continue to work and land on the same first screen.
 */
export default async function KYCIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: "/kyc/start",
    locale: locale as "ar" | "fr" | "en",
  });
}
