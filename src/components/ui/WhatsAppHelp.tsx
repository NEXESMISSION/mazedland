import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import { CONTACT_WHATSAPP, whatsappHref } from "@/lib/contact";
import { Ltr } from "@/components/ui/Ltr";

/**
 * « Une question ? Écrivez-nous sur WhatsApp » — one line, opening a chat
 * with Mazed Immo with a first sentence already typed. Messages only: there is
 * no « appeler » anywhere for this number.
 */
export function WhatsAppHelp({ topic, className = "" }: { topic?: "payment" | "pro"; className?: string }) {
  const t = useTranslations("whatsapp");
  const opening = t(topic === "payment" ? "openingPayment" : topic === "pro" ? "openingPro" : "opening");
  return (
    <a
      href={whatsappHref(opening)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-[12.5px] text-muted transition hover:text-foreground ${className}`}
    >
      <MessageCircle className="size-4 shrink-0 text-[#25D366]" strokeWidth={2.2} />
      <span>
        {t("help")} <span className="font-bold text-foreground"><Ltr>{CONTACT_WHATSAPP}</Ltr></span>
      </span>
    </a>
  );
}
