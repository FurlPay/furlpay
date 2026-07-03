import * as React from "react";

// ---------------------------------------------------------------------------
// Brand logos for coins, chains, stocks and card networks. Known assets use
// the official brand artwork (sourced from TradingView's symbol-logo CDN,
// self-hosted under apps/web/public/logos/ so there is no runtime dependency
// on an external host). The square source art is cropped to a circle.
// Unknown assets fall back to a self-contained inline SVG badge.
// ---------------------------------------------------------------------------

type LogoProps = { size?: number; className?: string; title?: string };

// Assets with a real logo file under public/logos/<dir>/<key>.svg.
const COIN_LOGOS = new Set(["USDC", "USDT", "EURC", "PYUSD", "DAI", "BTC", "ETH", "SOL"]);
const CHAIN_LOGOS = new Set(["ethereum", "solana", "arbitrum", "polygon", "optimism", "avalanche", "gnosis"]);
const STOCK_LOGOS = new Set(["AAPL", "NVDA", "TSLA", "VOO"]);

function LogoImg({ src, size = 24, className, title }: LogoProps & { src: string }) {
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

export function CoinLogo({ token, size = 24, className, title }: LogoProps & { token: string }) {
  const t = (token ?? "").toUpperCase();
  if (COIN_LOGOS.has(t)) {
    return <LogoImg src={`/logos/coins/${t.toLowerCase()}.svg`} size={size} className={className} title={title ?? token} />;
  }
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title ?? token}>
      {glyph((token || "?").slice(0, 1).toUpperCase())}
    </Badge>
  );
}

export function ChainLogo({ chain, size = 20, className, title }: LogoProps & { chain: string }) {
  const c = (chain ?? "").toLowerCase();
  if (CHAIN_LOGOS.has(c)) {
    return <LogoImg src={`/logos/chains/${c}.svg`} size={size} className={className} title={title ?? chain} />;
  }
  const node = CHAIN_BADGES[c];
  if (node) return React.cloneElement(node as React.ReactElement, { size, className, title: title ?? chain });
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title ?? chain}>
      {glyph((chain || "?").slice(0, 1).toUpperCase())}
    </Badge>
  );
}

export function StockLogo({ symbol, size = 24, className, title }: LogoProps & { symbol: string }) {
  const s = (symbol ?? "").toUpperCase();
  if (STOCK_LOGOS.has(s)) {
    return <LogoImg src={`/logos/stocks/${s.toLowerCase()}.svg`} size={size} className={className} title={title ?? symbol} />;
  }
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title ?? symbol}>
      {glyph((symbol || "?").slice(0, 2).toUpperCase(), 12, 15.5, 8)}
    </Badge>
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
