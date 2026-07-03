"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// Brand logos for coins, chains, stocks and card networks. Known assets use
// the official brand artwork (sourced from TradingView's symbol-logo CDN,
// self-hosted under apps/web/public/logos/ so there is no runtime dependency
// on an external host). The square source art is cropped to a circle.
// Assets without artwork fall back to a self-contained inline SVG badge —
// LogoImg swaps to the fallback automatically if its file 404s.
// ---------------------------------------------------------------------------

type LogoProps = { size?: number; className?: string; title?: string };

function LogoImg({
  src,
  size = 24,
  className,
  title,
  fallback,
}: LogoProps & { src: string; fallback: React.ReactNode }) {
  const [errored, setErrored] = React.useState(false);
  if (errored) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={title ?? ""}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: "50%", display: "inline-block", objectFit: "cover" }}
      draggable={false}
      onError={() => setErrored(true)}
    />
  );
}

function Badge({
  bg,
  size = 24,
  className,
  title,
  children,
  gradient,
}: {
  bg?: string;
  gradient?: [string, string];
  size?: number;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      {gradient ? (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={gradient[0]} />
            <stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      ) : null}
      <circle cx="12" cy="12" r="12" fill={gradient ? `url(#${id})` : bg} />
      {children}
    </svg>
  );
}

const glyph = (t: string, dx = 12, dy = 16.5, size = 12) => (
  <text x={dx} y={dy} textAnchor="middle" fontSize={size} fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">
    {t}
  </text>
);

// ---- Chain fallback badges (no official artwork available) ----
const CHAIN_BADGES: Record<string, React.ReactNode> = {
  base: <Badge bg="#0052FF" title="Base"><circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff" strokeWidth="2.2" /></Badge>,
};

function letterBadge(text: string, chars: number, size: number | undefined, className?: string, title?: string) {
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title}>
      {chars === 1
        ? glyph((text || "?").slice(0, 1).toUpperCase())
        : glyph((text || "?").slice(0, 2).toUpperCase(), 12, 15.5, 8)}
    </Badge>
  );
}

/** Generic asset logo: tries `src` (when given), falls back to a letter badge. */
export function AssetLogo({ src, label, size = 24, className, title }: LogoProps & { src?: string | null; label: string }) {
  const fallback = letterBadge(label, 2, size, className, title ?? label);
  if (!src) return fallback;
  return <LogoImg src={src} size={size} className={className} title={title ?? label} fallback={fallback} />;
}

export function CoinLogo({ token, size = 24, className, title }: LogoProps & { token: string }) {
  const t = (token ?? "").toUpperCase();
  const fallback = letterBadge(t, 1, size, className, title ?? token);
  if (!t) return fallback;
  return <LogoImg src={`/logos/coins/${t.toLowerCase()}.svg`} size={size} className={className} title={title ?? token} fallback={fallback} />;
}

export function ChainLogo({ chain, size = 20, className, title }: LogoProps & { chain: string }) {
  const c = (chain ?? "").toLowerCase();
  const node = CHAIN_BADGES[c];
  if (node) return React.cloneElement(node as React.ReactElement, { size, className, title: title ?? chain });
  const fallback = letterBadge(c, 1, size, className, title ?? chain);
  if (!c) return fallback;
  return <LogoImg src={`/logos/chains/${c}.svg`} size={size} className={className} title={title ?? chain} fallback={fallback} />;
}

export function StockLogo({ symbol, size = 24, className, title }: LogoProps & { symbol: string }) {
  const s = (symbol ?? "").toUpperCase();
  const fallback = letterBadge(s, 2, size, className, title ?? symbol);
  if (!s) return fallback;
  return (
    <LogoImg
      src={`/logos/stocks/${s.toLowerCase().replace(/\./g, "")}.svg`}
      size={size}
      className={className}
      title={title ?? symbol}
      fallback={fallback}
    />
  );
}

// ---- Card networks (rendered as wordmarks, not badges) ----
export function CardNetworkLogo({ network, className }: { network: string; className?: string }) {
  const n = network?.toLowerCase();
  if (n === "mastercard") {
    return (
      <svg viewBox="0 0 48 30" className={className} role="img" aria-label="Mastercard" width={40}>
        <circle cx="19" cy="15" r="11" fill="#EB001B" />
        <circle cx="29" cy="15" r="11" fill="#F79E1B" fillOpacity="0.9" />
      </svg>
    );
  }
  // Default: Visa wordmark.
  return (
    <span className={className} style={{ fontStyle: "italic", fontWeight: 800, letterSpacing: "0.5px", color: "#fff" }}>
      VISA
    </span>
  );
}
