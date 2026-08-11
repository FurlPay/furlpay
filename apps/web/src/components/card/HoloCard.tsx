"use client";

/*
 * The FurlPay holographic card — the physical-feeling green card first built
 * for /wallet, now shared. It is one piece of art with four editable slots
 * (brand, edition, name, two footer fields), so /wallet and /newsletter show
 * the same object rather than two drifting copies of it.
 *
 * Geometry, foil and tilt live in `wallet.css` (`.wallet-card`, `.card-*`);
 * any page rendering this component must import that stylesheet.
 */

import CardShader from "./CardShader";

export { handleSeed } from "./CardShader";

/** The FurlPay app icon.
 *
 * Two copies of the same artwork exist in `public/`: `/wallet/mark.png` (741 ×
 * 769, 634 KB, dark bleed baked into the corners) and `/icon.png` (512 × 512,
 * 24 KB, square). Square matters here — the card clips the icon with a 22%
 * radius, which only lands symmetrically on a square source — so new surfaces
 * use `/icon.png`. `/wallet` keeps `mark.png` as its default so a shipped page
 * does not change appearance as a side effect. */
export const BRAND_ICON = "/icon.png";
export const WALLET_ICON = "/wallet/mark.png";

export function FurlIcon({
  className = "",
  src = WALLET_ICON,
}: {
  className?: string;
  src?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand icon in public/, sized by CSS in three contexts; next/image's wrapper fights the 3D card layout
    <img
      src={src}
      alt="FurlPay"
      aria-hidden="true"
      className={`furl-icon ${className}`.trim()}
    />
  );
}

export interface HoloCardProps {
  /** Selects the shader's finish — see `handleSeed`. */
  seed: number;
  brand: string;
  edition: string;
  /** Centre line. Already formatted (the "@" is not added for you). */
  name: string;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  /** Surface class. Defaults to the standard card; the /wallet success view
   *  swaps in its own 3D face class. */
  surfaceClassName?: string;
  /** Brand mark drawn in the card's top-left. */
  iconSrc?: string;
  animated?: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: () => void;
}

export default function HoloCard({
  seed,
  brand,
  edition,
  name,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  surfaceClassName = "wallet-card",
  iconSrc = WALLET_ICON,
  animated = true,
  cardRef,
  onPointerMove,
  onPointerLeave,
}: HoloCardProps) {
  return (
    <div
      className={surfaceClassName}
      ref={cardRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div aria-hidden="true" className="card-base" />
      <CardShader seed={seed} animated={animated} />
      <div aria-hidden="true" className="card-foil card-foil-color" />
      <div aria-hidden="true" className="card-surface" />
      <div className="card-topline">
        <div className="card-brand">
          <FurlIcon src={iconSrc} />
          <span>{brand}</span>
        </div>
        <span className="card-edition">{edition}</span>
      </div>
      <div className="card-name-wrap">
        <div className="card-name">{name}</div>
      </div>
      <div className="card-bottomline">
        <div>
          <span className="card-label">{leftLabel}</span>
          <strong>{leftValue}</strong>
        </div>
        <div className="card-number">
          <span className="card-label">{rightLabel}</span>
          <strong>{rightValue}</strong>
        </div>
      </div>
    </div>
  );
}
