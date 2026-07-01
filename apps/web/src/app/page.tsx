import Link from "next/link";

// Marketing landing page (furlpay.app/). Server Component — no client JS needed.
export default function LandingPage() {
  const features = [
    { title: "Stablecoin cards", body: "Spend USDC/EURC anywhere on Visa with a self-custodial Safe." },
    { title: "Fractional investing", body: "Buy US stocks & ETFs from $1 via Alpaca." },
    { title: "Global banking", body: "Local IBAN/routing details & mid-market FX via Wise." },
    { title: "Developer-first", body: "SDKs, CLI, webhooks, Elements & an MCP server." },
  ];

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-5 pt-8">
        <div className="text-2xl font-extrabold tracking-tighter">
          Furl<span className="text-accent">pay</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/developer" className="text-textSecondary">Developers</Link>
          <Link href="/login" className="font-semibold text-accent">Sign in</Link>
        </nav>
      </header>

      <section className="px-5 pt-20 text-center">
        <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tighter">
          The Stripe + Coinbase<br />of stablecoins.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-textSecondary">
          Spend, invest, bank and build — one stablecoin super-app across every chain and currency.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link href="/signup" className="w-full max-w-xs rounded-pill bg-accent py-4 text-lg font-semibold">
            Get started
          </Link>
          <Link href="/dashboard" className="w-full max-w-xs rounded-pill border border-surfaceMuted bg-surface py-4 text-lg font-semibold">
            Open the app
          </Link>
        </div>
      </section>

      <section className="mt-20 grid grid-cols-1 gap-3 px-5 pb-16 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="surface-card p-5">
            <p className="font-bold">{f.title}</p>
            <p className="mt-1 text-[13px] text-textSecondary">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="px-5 pb-10 text-center text-[12px] text-textMuted">
        Furlpay · demo build · <Link href="/openapi.json" className="text-accent">API spec</Link>
      </footer>
    </div>
  );
}
