import { Clock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Said where a payment would start, in place of the button, while no payee
 * method is usable (`paymentsAreOpen()` in src/lib/payments/server.ts). The
 * words come from each page's own namespace — a placement, a Pro plan and a
 * receipt to upload each have their own « what happens meanwhile ».
 *
 * No hooks, so a server page and a client list can both render it.
 */
export function PaymentsClosedNotice({
  title,
  body,
  contactLabel,
  className,
}: {
  title: string;
  body: string;
  /** Adds a link to /contact, for whoever cannot wait. */
  contactLabel?: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn("mazed-tone-warn flex items-start gap-2.5 rounded-2xl px-4 py-3", className)}>
      <Clock className="mt-0.5 size-4 shrink-0" strokeWidth={2.4} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-extrabold">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed">{body}</p>
        {contactLabel && (
          <Link href="/contact" className="mt-1.5 inline-flex text-[12.5px] font-bold underline underline-offset-2">
            {contactLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
