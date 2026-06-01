"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Gavel } from "lucide-react";
import {
  ensureDepositsHydrated,
  getDepositState,
  subscribeDeposits,
} from "@/lib/depositStore";

/**
 * Shortcut shown on an auction card ONLY when the signed-in user already
 * holds an active caution on that live auction — so they can jump straight
 * to the bid page instead of opening the auction and hunting for the bid
 * action. Renders nothing otherwise (anon, no deposit, or not live), and
 * nothing before the client deposit store hydrates — so there's no layout
 * shift for the vast majority of cards. Must sit OUTSIDE the card's main
 * <Link> (anchors can't nest).
 */
export function StartBiddingButton({
  auctionId,
  isLive,
}: {
  auctionId: string;
  isLive: boolean;
}) {
  const [store, setStore] = useState(() => getDepositState());
  useEffect(() => {
    ensureDepositsHydrated();
    return subscribeDeposits(() => setStore(getDepositState()));
  }, []);

  if (!isLive || !store.hydrated || !store.ids.has(auctionId)) return null;

  return (
    <Link
      href={`/auctions/${auctionId}/bid` as `/auctions/${string}/bid`}
      className="batta-gold-fill mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full text-[12px] font-extrabold uppercase tracking-[0.12em] shadow-[var(--shadow-gold)] transition active:scale-[0.98]"
    >
      <Gavel className="size-3.5" strokeWidth={2.5} />
      Enchérir maintenant
    </Link>
  );
}
