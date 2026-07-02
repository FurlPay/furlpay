import Link from "next/link";

// Shared top bar for standalone marketing pages (/pricing, /about). `active`
// highlights the current nav item.
export default function MarketingBar({ active }: { active?: "pricing" | "about" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="Furlpay" width={28} height={28} className="h-7 w-7 rounded-lg" />
          <span className="text-xl font-extrabold tracking-tighter">Furlpay</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-textSecondary md:flex">
          <Link href="/#features" className="transition-colors hover:text-white">Features</Link>
          <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
          <Link href="/pricing" className={active === "pricing" ? "text-white" : "transition-colors hover:text-white"}>
            Pricing
          </Link>
          <Link href="/about" className={active === "about" ? "text-white" : "transition-colors hover:text-white"}>
            About
          </Link>
        </nav>
        <Link href="/signup" className="btn-green px-5 py-2 text-sm">Get started</Link>
      </div>
    </header>
  );
}
