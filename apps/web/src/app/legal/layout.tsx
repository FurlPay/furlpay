import Link from "next/link";
import LegalSidebar from "@/components/legal/LegalSidebar";

// Legal & policies section (furlpay.app/legal): sticky header + left nav rail +
// article column, matching the docs portal chrome.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-oled">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tighter">
              Furlpay <span className="text-textSecondary">Legal</span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-7 text-sm text-textSecondary md:flex">
            <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
            <Link href="/blog" className="transition-colors hover:text-white">Blog</Link>
          </nav>
          <Link href="/dashboard" className="btn-green px-4 py-2 text-sm md:ml-0">
            Open App
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6">
        <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] w-56 flex-shrink-0 overflow-y-auto py-10 md:block">
          <LegalSidebar />
        </aside>
        <main className="min-w-0 flex-1 py-10 md:max-w-3xl">{children}</main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neon shadow-glow-sm">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-black" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
