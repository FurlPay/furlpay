/*
 * Hero infrastructure diagram: your app → FurlPay API → products → settlement.
 *
 * A Server Component on purpose. The motion is two CSS animations (a travelling
 * gradient on the connectors, a slow opacity pulse on the status dot), so this
 * whole visual costs zero bytes of JavaScript and stops entirely under
 * prefers-reduced-motion via the global rule in globals.css.
 */

const LAYERS: {
  eyebrow: string;
  title: string;
  items: string[];
  accent?: boolean;
}[] = [
  {
    eyebrow: "Your application",
    title: "App, backend or agent",
    items: ["TypeScript", "Python", "Go", "Rust"],
  },
  {
    eyebrow: "One integration",
    title: "FurlPay API",
    items: ["REST", "Webhooks", "MCP", "x402"],
    accent: true,
  },
  {
    eyebrow: "Financial products",
    title: "Payments · Accounts · Cards · Stablecoins",
    items: ["Transfers", "Payouts", "FX", "Spend policies"],
  },
  {
    eyebrow: "Settlement",
    title: "USDC across chains",
    items: ["Arbitrum", "Base", "Ethereum", "Solana"],
  },
];

function Connector() {
  return (
    <div aria-hidden="true" className="flex justify-center py-1.5">
      <span className="flow-rail block h-7 w-px rounded-full" />
    </div>
  );
}

export default function InfraFlow() {
  return (
    <div className="relative">
      {/* Ambient wash sitting behind the stack, not over it. */}
      <div
        aria-hidden="true"
        className="ambient-drift pointer-events-none absolute -inset-8 -z-10 rounded-[40px] opacity-70"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 12%, rgba(0,229,153,0.13), transparent 70%)",
        }}
      />

      <div className="rounded-[26px] border border-white/[0.08] bg-black/40 p-4 backdrop-blur-sm sm:p-5">
        {LAYERS.map((layer, i) => (
          <div key={layer.title}>
            {i > 0 && <Connector />}
            <div
              className={`rounded-2xl border p-4 ${
                layer.accent
                  ? "border-neon/30 bg-neon/[0.06] shadow-[0_0_44px_-24px_rgba(0,229,153,0.9)]"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p
                  className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                    layer.accent ? "text-neon" : "text-textMuted"
                  }`}
                >
                  {layer.eyebrow}
                </p>
                {layer.accent && (
                  <span aria-hidden="true" className="flow-pulse h-1.5 w-1.5 rounded-full bg-neon" />
                )}
              </div>
              <p className="mt-1.5 text-[14px] font-semibold leading-snug text-white">{layer.title}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {layer.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10.5px] text-textSecondary"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
