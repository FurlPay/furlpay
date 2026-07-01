import Link from "next/link";
import DocsSidebar from "@/components/docs/DocsSidebar";
import DocsSearch from "@/components/docs/DocsSearch";

// Two-column docs portal (furlpay.app/docs): sticky header with fuzzy search +
// Open App, a left nav rail, and the article column on the right.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-oled">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
          <Link href="/" className="flex flex-shrink-0 items-center gap-2">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tighter">
              Furlpay <span className="text-textSecondary">Docs</span>
            </span>
          </Link>
          <div className="mx-auto flex-1 sm:flex sm:justify-center">
            <DocsSearch />
          </div>
          <Link href="/dashboard" className="btn-green flex-shrink-0 px-4 py-2 text-[13px]">
            Open App
          </Link>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto flex max-w-7xl gap-10 px-5">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-56 flex-shrink-0 overflow-y-auto py-10 md:block">
          <DocsSidebar />
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
