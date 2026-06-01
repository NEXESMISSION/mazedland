import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PrivacyContent } from "@/components/legal/LegalContent";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Batta.tn",
};

// Pure static content — prerender at build and serve from the edge CDN.
export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Légal" title="Politique de confidentialité" updated="2026">
      <PrivacyContent />
    </LegalPage>
  );
}
