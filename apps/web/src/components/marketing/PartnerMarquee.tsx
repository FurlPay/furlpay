// Continuously sliding partner marquee ("Trust Engine"). Monochrome brand
// wordmarks that colorize on hover; the track pauses on hover and stops for
// users who prefer reduced motion (see globals.css). Two identical sets are
// rendered so the -50% scroll loops seamlessly; the duplicate is hidden from
// screen readers.
const PARTNERS: { name: string; color: string }[] = [
  { name: "Stripe", color: "#635BFF" },
  { name: "Wise", color: "#9FE870" },
  { name: "Alpaca", color: "#FFD400" },
  { name: "Marqeta", color: "#FF5A5F" },
  { name: "Persona", color: "#5B4CF0" },
  { name: "Sardine", color: "#3B82F6" },
  { name: "Safe", color: "#12FF80" },
  { name: "Turnkey", color: "#8B93FF" },
  { name: "USDC", color: "#2775CA" },
  { name: "EURC", color: "#1A6DD8" },
  { name: "Base", color: "#0052FF" },
  { name: "Solana", color: "#14F195" },
  { name: "Arbitrum", color: "#28A0F0" },
];

export default function PartnerMarquee() {
  return (
    <div>
      <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-textMuted">
        Integrated rails, stablecoins &amp; networks
      </p>
      <div className="marquee-container" aria-label="Integrated partners and supported networks">
        <div className="marquee-track">
          <MarqueeSet />
          <MarqueeSet ariaHidden />
        </div>
      </div>
    </div>
  );
}

function MarqueeSet({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="marquee-set" aria-hidden={ariaHidden}>
      {PARTNERS.map((p) => (
        <span key={p.name} className="marquee-item" style={{ ["--brand" as string]: p.color }}>
          <span className="h-2 w-2 rounded-full bg-current" />
          <span className="text-[18px]">{p.name}</span>
        </span>
      ))}
    </div>
  );
}
