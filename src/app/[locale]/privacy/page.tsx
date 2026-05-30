import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PrivacyContent } from "@/components/legal/LegalContent";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Batta.tn",
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Légal" title="Politique de confidentialité" updated="2026">
      <PrivacyContent />
    </LegalPage>
  );
}
