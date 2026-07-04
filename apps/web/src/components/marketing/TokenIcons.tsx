// Brand marks for the wallet mockup. Coins and stocks use the official brand
// artwork (TradingView symbol logos, self-hosted under /public/logos/),
// cropped to a circle. Cash keeps a self-contained inline SVG.

type IconProps = { className?: string };

function LogoIcon({ src, alt, className }: IconProps & { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={`rounded-full ${className ?? ""}`} draggable={false} />
  );
}

// --- Stablecoins -------------------------------------------------------

export function UsdcIcon({ className }: IconProps) {
  return <LogoIcon src="/logos/coins/usdc.svg" alt="USDC" className={className} />;
}

export function EurcIcon({ className }: IconProps) {
  return <LogoIcon src="/logos/coins/eurc.svg" alt="EURC" className={className} />;
}

// --- Solana ------------------------------------------------------------

export function SolIcon({ className }: IconProps) {
  return <LogoIcon src="/logos/coins/sol.svg" alt="SOL" className={className} />;
}

// --- Equities ----------------------------------------------------------

export function AppleIcon({ className }: IconProps) {
  return <LogoIcon src="/logos/stocks/aapl.svg" alt="Apple" className={className} />;
}

export function TeslaIcon({ className }: IconProps) {
  return <LogoIcon src="/logos/stocks/tsla.svg" alt="Tesla" className={className} />;
}

// --- Cash --------------------------------------------------------------

export function UsdCashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1E7A46" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="1.4">
        <rect x="5.3" y="8" width="13.4" height="8" rx="1.6" />
        <circle cx="12" cy="12" r="1.9" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="7.6" cy="12" r="0.7" />
        <circle cx="16.4" cy="12" r="0.7" />
      </g>
    </svg>
  );
}
