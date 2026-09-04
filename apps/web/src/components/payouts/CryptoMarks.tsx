// ---------------------------------------------------------------------------
// Asset and network marks.
//
// Inline SVG rather than remote images: a payout screen that shows a broken
// image where a network logo should be is a screen people stop trusting, and
// these must render with no network round-trip, no CDN and no CSP exception.
//
// Each mark is drawn to the brand's actual geometry and official colour. They
// are deliberately simple — the recognisable silhouette and the right hue do
// the work at 20px, which is the size that matters here. Where a brand's mark
// is genuinely intricate, the simplified form is used rather than an inaccurate
// attempt at the detail.
// ---------------------------------------------------------------------------

interface MarkProps {
  size?: number;
  className?: string;
}

const box = (size: number) => ({ width: size, height: size, viewBox: "0 0 32 32" });

/** USDC — Circle's mark: white dollar glyph on the brand blue. */
export function UsdcMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="USDC" fill="none">
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M20.5 18.6c0-2.4-1.4-3.2-4.3-3.5-2-.3-2.4-.8-2.4-1.7s.7-1.5 2-1.5c1.2 0 1.9.4 2.2 1.4a.5.5 0 0 0 .5.35h1.1a.45.45 0 0 0 .45-.55 3.4 3.4 0 0 0-3-2.7V9.1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.25c-2 .28-3.25 1.6-3.25 3.28 0 2.27 1.37 3.12 4.27 3.42 1.87.23 2.43.66 2.43 1.72 0 1.05-.92 1.77-2.17 1.77-1.7 0-2.3-.72-2.5-1.7a.5.5 0 0 0-.48-.4h-1.16a.45.45 0 0 0-.45.53c.27 1.6 1.3 2.75 3.3 3.07v1.26a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1.25c2.03-.32 3.48-1.72 3.48-3.55Z"
        fill="#fff"
      />
      <path
        d="M12.9 25.2a9.7 9.7 0 0 1 0-18.4.62.62 0 0 0 .4-.6v-.9a.45.45 0 0 0-.6-.45 11.7 11.7 0 0 0 0 22.3.45.45 0 0 0 .6-.45v-.9a.62.62 0 0 0-.4-.6ZM19.7 4.85a.45.45 0 0 0-.6.45v.9c0 .27.16.5.4.6a9.7 9.7 0 0 1 0 18.4.62.62 0 0 0-.4.6v.9c0 .32.3.55.6.45a11.7 11.7 0 0 0 0-22.3Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Bitcoin — the ₿ on orange. */
export function BitcoinMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Bitcoin" fill="none">
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path
        d="M22.2 14.2c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6-1.3-.3.7-2.6-1.6-.4-.7 2.7-1-.25-2.3-.6-.45 1.75s1.25.28 1.2.3c.68.17.8.62.78 1l-.78 3.14a1.4 1.4 0 0 1 .17.06l-.18-.05-1.1 4.4c-.08.2-.3.5-.76.4.02.02-1.2-.3-1.2-.3l-.8 1.87 2.16.54 1.18.31-.7 2.75 1.65.4.68-2.7c.45.13.88.24 1.3.35l-.67 2.68 1.65.41.7-2.74c2.8.53 4.92.32 5.8-2.22.72-2.05-.03-3.23-1.5-4 1.08-.25 1.9-.96 2.1-2.42Zm-3.76 5.3c-.5 2.04-3.95.94-5.07.66l.92-3.68c1.12.28 4.7.83 4.15 3.02Zm.51-5.33c-.46 1.86-3.33.92-4.26.69l.83-3.34c.93.23 3.9.66 3.43 2.65Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Ethereum — the faceted diamond. */
export function EthereumMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Ethereum" fill="none">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path d="M16.5 5v8.15l6.9 3.08L16.5 5Z" fill="#fff" fillOpacity=".6" />
      <path d="M16.5 5 9.6 16.23l6.9-3.08V5Z" fill="#fff" />
      <path d="M16.5 21.5v5.5l6.9-9.55-6.9 4.05Z" fill="#fff" fillOpacity=".6" />
      <path d="M16.5 27v-5.5l-6.9-4.05L16.5 27Z" fill="#fff" />
      <path d="M16.5 20.2l6.9-4.05-6.9-3.07v7.12Z" fill="#fff" fillOpacity=".2" />
      <path d="M9.6 16.15l6.9 4.05v-7.12l-6.9 3.07Z" fill="#fff" fillOpacity=".6" />
    </svg>
  );
}

/** Base — the concentric square-in-circle on Base blue. */
export function BaseMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Base" fill="none">
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      <path
        d="M15.9 26c5.6 0 10.1-4.5 10.1-10S21.5 6 15.9 6C10.6 6 6.3 10 5.9 15.1h13.3v1.8H5.9C6.3 22 10.6 26 15.9 26Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Arbitrum — the chevron on the deep navy field. */
export function ArbitrumMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Arbitrum" fill="none">
      <circle cx="16" cy="16" r="16" fill="#213147" />
      <path d="m16 6.6 8.3 4.8v9.2L16 25.4l-8.3-4.8v-9.2L16 6.6Z" fill="#213147" />
      <path d="m18.4 13.6 2.2 3.8-2.6 4.5-2.2-3.8 2.6-4.5Z" fill="#12AAFF" />
      <path d="m13.6 12.1 5.4 9.4-2.3 1.3-5.4-9.4 2.3-1.3Z" fill="#9DCCED" />
      <path d="M16 6.6 7.7 11.4v9.2L16 25.4l8.3-4.8v-9.2L16 6.6Zm0 1.9 6.7 3.9v7.7L16 24l-6.7-3.9v-7.7L16 8.5Z" fill="#fff" />
    </svg>
  );
}

/** Polygon — the interlocking hexagon mark on brand violet. */
export function PolygonMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Polygon" fill="none">
      <circle cx="16" cy="16" r="16" fill="#8247E5" />
      <path
        d="M21 13.2c-.36-.2-.83-.2-1.23 0l-2.83 1.67-1.92 1.07-2.8 1.67c-.36.2-.83.2-1.23 0l-2.2-1.3a1.25 1.25 0 0 1-.62-1.07v-2.53c0-.43.23-.83.62-1.07l2.17-1.26c.36-.2.83-.2 1.23 0l2.17 1.3c.36.2.6.6.6 1.06v1.67l1.92-1.1v-1.7c0-.43-.23-.83-.62-1.07l-4.03-2.36c-.36-.2-.83-.2-1.23 0L6.9 10.6c-.4.24-.63.64-.63 1.07v4.7c0 .43.23.83.62 1.07l4.06 2.36c.37.2.83.2 1.23 0l2.8-1.63 1.93-1.1 2.8-1.64c.37-.2.84-.2 1.24 0l2.16 1.27c.37.2.6.6.6 1.06v2.54c0 .43-.23.83-.6 1.07l-2.13 1.26c-.37.2-.84.2-1.24 0l-2.16-1.26a1.25 1.25 0 0 1-.6-1.07V18.7l-1.94 1.1v1.66c0 .43.24.84.63 1.07l4.06 2.37c.36.2.83.2 1.23 0l4.06-2.37c.36-.2.6-.6.6-1.06v-4.74c0-.43-.24-.83-.63-1.07L21 13.2Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Solana — the three angled bars in the brand gradient. */
export function SolanaMark({ size = 24, className }: MarkProps) {
  const id = `sol-${size}`;
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Solana" fill="none">
      <defs>
        <linearGradient id={id} x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill="#0B0B12" />
      <path d="M10.2 20.3a.6.6 0 0 1 .43-.18h13.1c.27 0 .4.32.21.5l-2.6 2.6a.6.6 0 0 1-.42.18H7.83a.3.3 0 0 1-.21-.5l2.58-2.6Z" fill={`url(#${id})`} />
      <path d="M10.2 8.6a.6.6 0 0 1 .43-.18h13.1c.27 0 .4.33.21.51l-2.6 2.6a.6.6 0 0 1-.42.17H7.83a.3.3 0 0 1-.21-.5l2.58-2.6Z" fill={`url(#${id})`} />
      <path d="M21.34 14.42a.6.6 0 0 0-.42-.17H7.83a.3.3 0 0 0-.21.5l2.58 2.6c.11.12.27.18.43.18h13.1a.3.3 0 0 0 .21-.51l-2.6-2.6Z" fill={`url(#${id})`} />
    </svg>
  );
}

/** Lightning — the bolt. Yellow rather than Bitcoin orange, so the rail is
 *  distinguishable from on-chain BTC at a glance. */
export function LightningMark({ size = 24, className }: MarkProps) {
  return (
    <svg {...box(size)} className={className} role="img" aria-label="Bitcoin Lightning" fill="none">
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path d="M18.4 5 9.6 17.3h5.1L13.2 27l9.2-12.7h-5.4L18.4 5Z" fill="#fff" />
    </svg>
  );
}

// ── lookup ────────────────────────────────────────────────────────────────

export type MarkKey =
  | "usdc"
  | "btc"
  | "sol"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "polygon"
  | "solana"
  | "lightning"
  | "bitcoin";

export function CryptoMark({ mark, size = 24, className }: { mark: MarkKey } & MarkProps) {
  switch (mark) {
    case "usdc":
      return <UsdcMark size={size} className={className} />;
    case "btc":
    case "bitcoin":
      return <BitcoinMark size={size} className={className} />;
    case "ethereum":
      return <EthereumMark size={size} className={className} />;
    case "base":
      return <BaseMark size={size} className={className} />;
    case "arbitrum":
      return <ArbitrumMark size={size} className={className} />;
    case "polygon":
      return <PolygonMark size={size} className={className} />;
    case "sol":
    case "solana":
      return <SolanaMark size={size} className={className} />;
    case "lightning":
      return <LightningMark size={size} className={className} />;
  }
}
