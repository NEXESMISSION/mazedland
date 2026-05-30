import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { TermsContent } from "@/components/legal/LegalContent";

export const metadata: Metadata = {
  title: "Conditions d'utilisation — Batta.tn",
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Légal" title="Conditions d'utilisation" updated="2026">
      <TermsContent />
    </LegalPage>
  );
}
