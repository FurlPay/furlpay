import * as React from "react";

// ---------------------------------------------------------------------------
// Brand logos for coins, chains and card networks. Self-contained inline SVGs
// (license-safe, no external icon dependency) using each brand's palette and a
// recognizable glyph. Rendered as circular badges sized by `size`.
// ---------------------------------------------------------------------------

type LogoProps = { size?: number; className?: string; title?: string };

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

// ---- Coins / stablecoins ----
const COINS: Record<string, React.ReactNode> = {
  USDC: <Badge bg="#2775CA" title="USDC">{glyph("$")}</Badge>,
  USDT: <Badge bg="#26A17B" title="USDT">{glyph("₮")}</Badge>,
  EURC: <Badge bg="#2775CA" title="EURC">{glyph("€")}</Badge>,
  PYUSD: <Badge bg="#00457C" title="PYUSD">{glyph("$")}</Badge>,
  DAI: <Badge bg="#F5AC37" title="DAI">{glyph("D")}</Badge>,
  BTC: <Badge bg="#F7931A" title="Bitcoin">{glyph("₿")}</Badge>,
  ETH: (
    <Badge bg="#627EEA" title="Ethereum">
      <path d="M12 4l4.5 8L12 14.5 7.5 12 12 4z" fill="#fff" opacity="0.9" />
      <path d="M12 15.4l4.5-2.6L12 20l-4.5-7.2 4.5 2.6z" fill="#fff" opacity="0.6" />
    </Badge>
  ),
};

// ---- Chains / networks ----
const CHAINS: Record<string, React.ReactNode> = {
  ethereum: COINS.ETH,
  base: <Badge bg="#0052FF" title="Base"><circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff" strokeWidth="2.2" /></Badge>,
  arbitrum: <Badge bg="#12AAFF" title="Arbitrum">{glyph("A")}</Badge>,
  polygon: <Badge bg="#8247E5" title="Polygon">{glyph("P")}</Badge>,
  solana: (
    <Badge gradient={["#9945FF", "#14F195"]} title="Solana">
      <g fill="#fff">
        <rect x="7" y="8" width="10" height="1.8" rx="0.9" transform="skewX(-18)" />
        <rect x="6" y="11.1" width="10" height="1.8" rx="0.9" transform="skewX(18)" />
        <rect x="7" y="14.2" width="10" height="1.8" rx="0.9" transform="skewX(-18)" />
      </g>
    </Badge>
  ),
  gnosis: <Badge bg="#3E6957" title="Gnosis">{glyph("G")}</Badge>,
  optimism: <Badge bg="#FF0420" title="Optimism">{glyph("O")}</Badge>,
  avalanche: <Badge bg="#E84142" title="Avalanche">{glyph("A")}</Badge>,
};

export function CoinLogo({ token, size = 24, className, title }: LogoProps & { token: string }) {
  const node = COINS[token?.toUpperCase()];
  if (node) return React.cloneElement(node as React.ReactElement, { size, className, title: title ?? token });
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title ?? token}>
      {glyph((token || "?").slice(0, 1).toUpperCase())}
    </Badge>
  );
}

export function ChainLogo({ chain, size = 20, className, title }: LogoProps & { chain: string }) {
  const node = CHAINS[chain?.toLowerCase()];
  if (node) return React.cloneElement(node as React.ReactElement, { size, className, title: title ?? chain });
  return (
    <Badge bg="#3A3A3C" size={size} className={className} title={title ?? chain}>
      {glyph((chain || "?").slice(0, 1).toUpperCase())}
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
