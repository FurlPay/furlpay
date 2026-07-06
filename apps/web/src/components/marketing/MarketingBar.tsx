import Link from "next/link";

// Shared top bar for standalone marketing pages. `active` highlights the current nav item.
export default function MarketingBar({
  active,
}: {
  active?: "pricing" | "about" | "changelog" | "community" | "compare" | "partners" | "use-cases" | "talk-to-us" | "ambassadors";
}) {
  const link = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={active === key ? "text-white" : "transition-colors hover:text-white"}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="Furlpay" width={28} height={28} className="h-7 w-7 rounded-lg" />
          <span className="text-xl font-extrabold tracking-tighter">Furlpay</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-textSecondary md:flex">
          <Link href="/products" className="transition-colors hover:text-white">Products</Link>
          <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
          {link("/pricing", "Pricing", "pricing")}
          {link("/ambassadors", "Creators", "ambassadors")}
          {link("/community", "Community", "community")}
          {link("/changelog", "Changelog", "changelog")}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/talk-to-us" className="hidden text-sm text-textSecondary transition-colors hover:text-white sm:block">
            Talk to us
          </Link>
          <Link href="/signup" className="btn-green px-5 py-2 text-sm">Get started</Link>
        </div>
      </div>
    </header>
  );
}
