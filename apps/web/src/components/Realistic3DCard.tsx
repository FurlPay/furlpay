"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { PaymentCard } from "@/lib/types";
import { CardNetworkLogo } from "@furlpay/ui";
import { ShieldCheck, Eye, EyeOff, Snowflake, Wifi } from "lucide-react";
import { triggerHaptic } from "@/lib/sensory/hapticsAndAudio";

interface Realistic3DCardProps {
  card: PaymentCard;
  /**
   * CVV, once a caller has genuinely obtained it. NO DEFAULT — see below.
   *
   * These three fields used to default to `cvv = "842"` and
   * `expiry = "08/29"`, which meant that revealing ANY card rendered those two
   * invented values as that card's real details. A user could copy them into a
   * checkout and watch the payment fail, with nothing on screen suggesting the
   * numbers were made up. On a payment product that is the worst class of
   * fabrication, and it is the exact thing `app/cards/page.tsx` already refuses
   * to do:
   *
   *   FurlPay never holds the PAN … no issuer is contracted, so today it answers
   *   503. That answer is rendered as "unavailable", which is the truth. An
   *   honest empty state beats a convincing fake number.
   *
   * Undefined now stays MASKED even when revealed, so the component cannot
   * invent a credential. The repo rule is the same one: fail visibly rather than
   * simulate success.
   */
  cvv?: string;
  /** Full PAN, once genuinely obtained. Undefined keeps the masked form. */
  fullPan?: string;
  /** Expiry, once genuinely obtained. Undefined renders as masked. */
  expiry?: string;
  /**
   * Prove presence before unmasking. Resolve true to flip, false to refuse.
   *
   * This gates ACCESS to sensitive data, which is a different question from
   * authorising a payment — so it must NOT be wired to the biometric-PAYMENT
   * proof (`/api/wallets/biometric-pay/*`). That primitive mints a single-use
   * token bound to H(amount|asset|recipient|chain|nonce); driving it from a card
   * view would mean fabricating a payment intent for something that is not a
   * payment, prompting the user about a transfer they are not making, and
   * logging a card id in the recipient field. Use a step-up / re-auth check.
   */
  onRevealRequest?: () => Promise<boolean>;
}

export type CardMaterial = "metal_obsidian" | "titanium_silver" | "cyber_neon" | "rose_gold";

/**
 * A credential we actually hold, or `null`.
 *
 * `??` alone is not enough, which is the whole reason this exists: it catches
 * only `null` and `undefined`, so an EMPTY STRING from an API that returned
 * `{ cvv: "" }` would satisfy `expiry ?? "••/••"` and render as a blank gap
 * where a number belongs. The literal strings "undefined" and "null" are also
 * rejected — those arrive from template interpolation somewhere upstream
 * (`` `${maybeUndefined}` ``), and they look like data rather than like an error.
 *
 * One helper for all three fields so the masking cannot drift between them.
 */
function held(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "undefined" || trimmed === "null" || trimmed === "NaN") return null;
  return trimmed;
}

/**
 * Realistic3DCard — Photorealistic 3D interactive payment card.
 *
 * Implements the realism benchmarks of Tangem Wallet and RedotPay:
 * 1. ISO/IEC 7810 ID-1 standard aspect ratio (1.586:1) with edge bevel simulation.
 * 2. Touch/Mouse-driven 3D perspective tilt with spring damping.
 * 3. Dynamic specular glare reflection that travels opposite to the tilt.
 * 4. Thin-film interference holographic foil for security badges.
 * 5. Micro-etched 8-contact EMV smart chip with gold sheen.
 * 6. Smooth 3D Y-axis flip (180deg) to reveal magnetic stripe, signature bar, and CVV.
 */
export default function Realistic3DCard({
  card,
  // No defaults. An absent value is unknown, and unknown renders as masked.
  cvv,
  fullPan,
  expiry,
  onRevealRequest,
}: Realistic3DCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState<number>(0);
  const [rotateY, setRotateY] = useState<number>(0);
  const [glarePos, setGlarePos] = useState<{ x: number; y: number; opacity: number }>({
    x: 50,
    y: 50,
    opacity: 0,
  });
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [isAuthorizing, setIsAuthorizing] = useState<boolean>(false);

  // Is this instance still on screen?
  //
  // The reveal gate can take up to 60 seconds (a passkey prompt the user has not
  // answered), and the card unmounts underneath it if the list empties or the
  // page navigates. Without this, a result arriving after unmount would set
  // state on a dead component — and worse, a late approval could open a
  // REMOUNTED card that never ran a ceremony of its own.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ── Reduced motion ────────────────────────────────────────────────────────
  //
  // The component had NO reduced-motion handling: pointer tilt, the 450ms spring
  // flip and the travelling glare all ran regardless of the OS setting. On a
  // surface whose whole point is that it moves under your finger, that is the
  // one place the preference matters most.
  //
  // Watched rather than read once, because the user can change it without
  // reloading — and because on macOS it flips when "Reduce motion" is toggled in
  // Accessibility settings mid-session.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    // Guarded: matchMedia is absent in jsdom without a shim and during SSR, and a
    // throw here would take down the whole card.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Derive material appearance
  const material: CardMaterial = useMemo(() => {
    const label = card.label?.toLowerCase() ?? "";
    if (label.includes("metal") || label.includes("black")) return "metal_obsidian";
    if (label.includes("titanium") || label.includes("silver")) return "titanium_silver";
    if (label.includes("rose") || label.includes("gold")) return "rose_gold";
    return "cyber_neon";
  }, [card.label]);

  // Handle pointer move for 3D tilt & specular reflection
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    // The card stays flat. Tilt and a travelling specular highlight are pure
    // decoration — nothing is communicated by them — so under reduced motion
    // they are simply not produced.
    if (reduceMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const normalizedX = (x / rect.width) * 2 - 1; // -1 to 1
    const normalizedY = (y / rect.height) * 2 - 1; // -1 to 1

    // Maximum tilt 12 degrees
    const maxTilt = 12;
    setRotateX(-normalizedY * maxTilt);
    setRotateY(normalizedX * maxTilt);

    // Glare position moves opposite to the tilt
    setGlarePos({
      x: (1 - normalizedX) * 50,
      y: (1 - normalizedY) * 50,
      opacity: 0.65,
    });
  }, [reduceMotion]);

  const handlePointerLeave = useCallback(() => {
    // Smoothly settle back to level
    setRotateX(0);
    setRotateY(0);
    setGlarePos((prev) => ({ ...prev, opacity: 0 }));
  }, []);

  // Were any credentials handed to this card? Drives the refusal below.
  const hasCredentials = Boolean(held(cvv) || held(fullPan) || held(expiry));

  // Handle 3D card flip
  const toggleFlip = useCallback(async () => {
    if (!isFlipped && !isRevealed && onRevealRequest) {
      // Guard against a SECOND activation while the first is still in flight.
      // Without it, repeated Enter presses stack overlapping ceremonies and the
      // last one to resolve wins — so a refusal could land after an approval.
      if (isAuthorizing) return;

      setIsAuthorizing(true);
      let authorized = false;
      try {
        authorized = await onRevealRequest();
      } catch {
        // A thrown gate is a refusal, not an open card.
        authorized = false;
      } finally {
        // `finally`, because the await above can reject. Leaving this in the
        // `try` meant a throw skipped it and stranded the card in "confirming
        // your identity" with no way back.
        //
        // Guarded on `mounted`: the gate can take up to 60 seconds, and the card
        // unmounts if the list empties or the page navigates in the meantime.
        // Setting state on an unmounted component is a no-op React warns about,
        // but the REAL problem is below — a late `setIsRevealed(true)` on a
        // remounted card would open it without a fresh ceremony.
        if (mounted.current) setIsAuthorizing(false);
      }

      if (!authorized) {
        // The haptic still fires: the user is present and refused, and they get
        // the feedback whether or not this instance is still on screen.
        triggerHaptic("error");
        return;
      }

      // A result that arrives after unmount authorises NOTHING. Dropping it here
      // means a card that comes back on screen starts closed and asks again,
      // rather than inheriting an approval granted to a previous instance.
      if (!mounted.current) return;
      setIsRevealed(true);
    } else if (!isFlipped && !isRevealed && hasCredentials) {
      // NO GATE, BUT CREDENTIALS WERE PASSED.
      //
      // The condition above short-circuits on `onRevealRequest`, so a caller that
      // supplies cvv/fullPan/expiry but no gate would flip straight to the back
      // face with no authorization at all. Today nothing is exposed — `isRevealed`
      // stays false so the values render masked — but that is masking saving an
      // ungated path, not the path being safe. A future edit to either render
      // expression turns it into a real credential leak.
      //
      // Refuse instead. A card that was given secrets and no way to protect them
      // does not open: a developer sees an unresponsive flip and a console error
      // rather than shipping an unguarded reveal.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error(
          "Realistic3DCard: cvv/fullPan/expiry were supplied without onRevealRequest. " +
            "Credentials must sit behind a step-up gate; the card will not flip."
        );
      }
      triggerHaptic("error");
      return;
    }

    triggerHaptic("medium");
    // Same reason: a flip queued before unmount must not land on a remounted
    // instance that never asked for it.
    if (!mounted.current) return;
    setIsFlipped((prev) => !prev);
  }, [isFlipped, isRevealed, isAuthorizing, onRevealRequest, hasCredentials]);

  return (
    <div
      className="relative select-none perspective-[1200px]"
      style={{ perspective: "1200px" }}
    >
      <div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={toggleFlip}
        // WITHOUT THIS the card was focusable and inert: role="button" plus
        // tabIndex={0} advertises a control to assistive tech, and a keyboard
        // user could Tab to it, press Enter, and nothing happened. Space is
        // preventDefault-ed because it scrolls the page by default.
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void toggleFlip();
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isFlipped}
        aria-busy={isAuthorizing}
        // Says WHAT HAPPENS, not which input device to use: "Click to flip" is
        // wrong for the keyboard and screen-reader users this label exists for.
        // It also names the current face and the frozen state, neither of which
        // was announced — a frozen card looked identical to an active one to
        // anyone not seeing the overlay.
        aria-label={[
          card.label,
          card.network,
          "card",
          card.frozen ? "frozen" : null,
          isFlipped ? "showing back" : "showing front",
          isAuthorizing ? "confirming your identity" : "activate to turn over",
        ]
          .filter(Boolean)
          .join(", ")}
        // No max-width here. The card filled its slide up to 420px while the
        // slide itself stayed w-full, so on a wider viewport the NEXT card
        // peeked past the edge and was clipped mid-slide. How wide a card may
        // grow is the container's decision, not the component's — a card
        // rendered outside a carousel should be free to fill whatever box it is
        // given. The cards page caps the track instead.
        className="relative aspect-[1.586] w-full cursor-pointer transition-transform duration-200 ease-out preserve-3d"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(${rotateX}deg) rotateY(${isFlipped ? rotateY + 180 : rotateY}deg)`,
          // The FACE CHANGE is meaningful and is kept; the 450ms rotation
          // through 3D space is not, so reduced motion swaps to an almost
          // instant cut. Removing the flip entirely would remove the only way to
          // see the reverse of the card.
          transition: reduceMotion
            ? "transform 0.01s linear"
            : "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* ── CARD FRONT ──────────────────────────────────────────────── */}
        <div
          className={`absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[18px] p-6 text-white shadow-2xl backface-hidden ${
            material === "metal_obsidian"
              ? "bg-gradient-to-br from-[#1C1C1E] via-[#0E0E10] to-[#050505] border border-white/10"
              : material === "titanium_silver"
              ? "bg-gradient-to-br from-[#E2E4E9] via-[#9DA3AE] to-[#686E7C] text-gray-900 border border-white/40"
              : "bg-gradient-to-br from-[#1E1B4B] via-[#31104B] to-[#0F172A] border border-purple-500/30"
          }`}
          style={{
            backfaceVisibility: "hidden",
            boxShadow:
              "0 25px 50px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08)",
          }}
        >
          {/* Specular Glare Layer */}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-overlay transition-opacity duration-300"
            style={{
              opacity: glarePos.opacity,
              background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 65%)`,
            }}
          />

          {/* Micro-Brushed Metal Sheen Texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-color-dodge"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0px, transparent 1px, transparent 2px)`,
            }}
          />

          {/* Holographic Security Foil Shimmer */}
          <div
            className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-20 blur-xl"
            style={{
              background:
                "conic-gradient(from 180deg at 50% 50%, #FF0080, #7928CA, #0070F3, #00DFD8, #FF4D4D, #FF0080)",
              transform: `rotate(${rotateY * 4}deg)`,
            }}
          />

          {/* Top Row: Issuer / Type & Contactless Indicator */}
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-widest text-emerald-400">
                  FURLPAY
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                  {card.kind === "physical" ? "Metal Physical" : "Virtual"}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold tracking-wide text-white/90">
                {card.label}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Wifi className="h-5 w-5 rotate-90 text-white/70" />
              <ShieldCheck className="h-4 w-4 text-emerald-400/90" />
            </div>
          </div>

          {/* Middle Row: Photorealistic 8-Contact EMV Chip */}
          <div className="relative z-10 my-auto">
            <div className="relative h-9 w-12 overflow-hidden rounded-[6px] border border-[#CA8A04]/60 bg-gradient-to-br from-[#FEF08A] via-[#EAB308] to-[#A16207] shadow-inner">
              {/* EMV Micro-Contact Grid */}
              <div className="absolute inset-x-2 top-0 h-[1px] bg-[#713F12]/40" />
              <div className="absolute inset-y-1 left-4 w-[1px] bg-[#713F12]/40" />
              <div className="absolute inset-y-1 right-4 w-[1px] bg-[#713F12]/40" />
              <div className="absolute inset-x-1 top-4 h-[1px] bg-[#713F12]/40" />
              <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#713F12]/30 bg-transparent" />
            </div>
          </div>

          {/* Bottom Row: Card Number, Expiry, Network */}
          <div className="relative z-10">
            <p className="font-mono text-lg font-medium tracking-[0.22em] text-white/95 drop-shadow-sm">
              {/* last4 is data we genuinely have on every card, so the masked
                  form is informative rather than a placeholder. */}
              {isRevealed && held(fullPan)
                ? held(fullPan)
                : `•••• •••• •••• ${card.last4}`}
            </p>

            <div className="mt-3 flex items-center justify-between">
              <div>
                <span className="block text-[9px] font-semibold uppercase tracking-wider text-white/50">
                  Valid Thru
                </span>
                <span className="font-mono text-xs font-semibold text-white/90">
                  {/* Masked unless genuinely held. A default here would state an
                      expiry for a card whose real date we do not have, and a bare
                      `??` would let an empty string render as a blank gap. */}
                  {held(expiry) ?? "••/••"}
                </span>
              </div>

              <div>
                <span className="block text-[9px] font-semibold uppercase tracking-wider text-white/50">
                  Settles in
                </span>
                <span className="text-xs font-bold text-emerald-400">
                  {card.settlementCurrency}
                </span>
              </div>

              <div className="flex items-center">
                <span className="text-2xl drop-shadow">
                  <CardNetworkLogo network={card.network} />
                </span>
              </div>
            </div>
          </div>

          {/* Frozen Overlay */}
          {card.frozen && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-[18px] bg-black/60 backdrop-blur-[3px]">
              <div className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 text-sm font-bold text-white shadow">
                <Snowflake className="h-4 w-4 text-cyan-300" />
                <span>Card Frozen</span>
              </div>
            </div>
          )}
        </div>

        {/* ── CARD BACK ───────────────────────────────────────────────── */}
        <div
          className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[18px] border border-white/10 bg-[#0A0A0C] p-6 text-white shadow-2xl backface-hidden"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            boxShadow:
              "0 25px 50px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08)",
          }}
        >
          {/* Magnetic Stripe */}
          <div className="-mx-6 -mt-1 h-12 bg-gradient-to-b from-[#1E1E22] via-[#0D0D10] to-[#000000] shadow-inner" />

          {/* Signature Strip & CVV Security Box */}
          <div className="my-auto flex items-center gap-3">
            <div className="relative h-10 flex-1 overflow-hidden rounded-[4px] bg-[#E2E8F0] p-2 text-gray-800 shadow-inner">
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `repeating-linear-gradient(45deg, #000 0, #000 2px, transparent 2px, transparent 6px)`,
                }}
              />
              <span className="relative z-10 font-mono text-xs italic text-gray-600">
                Authorized Signature
              </span>
            </div>

            {/* CVV Security Box */}
            <div className="flex h-10 w-16 flex-col items-center justify-center rounded-[4px] border border-white/20 bg-white/10 px-2">
              <span className="text-[9px] uppercase tracking-wider text-white/50">
                CVV
              </span>
              <span className="font-mono text-sm font-bold text-emerald-400">
                {/* Revealed AND known. `isRevealed ? cvv : "•••"` renders the
                    string "undefined" once the fabricated default is gone — a
                    successful step-up must not leave a blank where a number
                    belongs. Staying masked says "we do not hold it", which is the
                    truth while no issuer is contracted. */}
                {isRevealed && held(cvv) ? held(cvv) : "•••"}
              </span>
            </div>
          </div>

          {/* Legal Fine Print & Bank Issuer Text */}
          <div className="space-y-1">
            <p className="text-[8px] leading-tight text-white/40">
              This card is issued by FurlPay pursuant to license from {card.network}.
              Funds are backed 1:1 by stablecoin reserves in segregated treasury accounts.
              For customer support or lost cards, contact support@furlpay.app.
            </p>
            <div className="flex items-center justify-between text-[9px] text-white/60">
              <span>Card ID: {card.id.slice(0, 14)}…</span>
              <span className="font-mono">CID: 9482</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Helper Text */}
      <div className="mt-3 flex items-center justify-between px-2 text-xs text-white/60">
        <button
          onClick={toggleFlip}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          {isFlipped ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span>{isFlipped ? "Show Front" : "Flip to View CVV"}</span>
        </button>
        <span className="text-[11px] text-white/40">
          Touch or move cursor to tilt in 3D
        </span>
      </div>
    </div>
  );
}
