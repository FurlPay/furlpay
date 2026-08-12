"use client";

/*
 * The /wallet holographic card, on the landing page.
 *
 * Same component, same stylesheet, same shader as furlpay.com/wallet — not a
 * screenshot and not a second implementation. It tilts to the pointer exactly
 * as the reservation card does; the WebGL loop is throttled to ~30fps, pauses
 * when scrolled out of view, and renders a single static frame under
 * prefers-reduced-motion (see components/card/CardShader.tsx).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import HoloCard, { BRAND_ICON, handleSeed } from "@/components/card/HoloCard";
import { editionLabel } from "@/components/card/edition";

const SEED = handleSeed("furlpay-card");
const HANDLE = "yourname";

export default function WalletCardTeaser({ initialEdition }: { initialEdition: string }) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Rendered on the server with the build-time month, corrected on mount so a
  // statically generated page cannot show a stale issue stamp.
  const [edition, setEdition] = useState(initialEdition);
  useEffect(() => setEdition(editionLabel(new Date())), []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--ry", `${px * 10}deg`);
    card.style.setProperty("--rx", `${-py * 10}deg`);
    card.style.setProperty("--mx", `${px * 40}px`);
    card.style.setProperty("--my", `${py * 40}px`);
  }, []);

  const onPointerLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--mx", "0px");
    card.style.setProperty("--my", "0px");
  }, []);

  return (
    <div className="card-teaser flex w-full max-w-[420px] flex-col items-center">
      <div className="wallet-card-stage w-full">
        <HoloCard
          seed={SEED}
          iconSrc={BRAND_ICON}
          brand="FurlPay Wallet"
          edition={edition}
          name={`@${HANDLE}`}
          leftLabel="IDENTITY"
          leftValue="ACCOUNT & AGENT"
          rightLabel="ONE OF ONE"
          rightValue={`${HANDLE}.furlpay.com`}
          cardRef={cardRef}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </div>

      <Link
        href="/wallet"
        className="btn-green inline-flex items-center gap-2 px-6 py-3 text-[15px]"
      >
        Get your card today
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
      <p className="mt-3 max-w-xs text-center text-[12px] leading-relaxed text-textMuted">
        Reserve a handle your account and its agents present when they pay. Free to reserve.
      </p>
    </div>
  );
}
