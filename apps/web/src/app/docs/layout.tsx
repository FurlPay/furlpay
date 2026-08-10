import Link from "next/link";
import DocsSidebar from "@/components/docs/DocsSidebar";
import DocsSearch from "@/components/docs/DocsSearch";
import DocsToc from "@/components/docs/DocsToc";
import DocsMobileNav from "@/components/docs/DocsMobileNav";
import Breadcrumbs from "@/components/docs/Breadcrumbs";
import "./docs-theme.css";

// Three-column docs portal (furlpay.app/docs): sticky header with fuzzy search
// + Open App, a left nav rail, the article column, and an "On this page" ToC
// rail on the right. Mobile gets a hamburger slide-over instead of the rail.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-theme min-h-screen">
      {/* Header — 64px tall; every sticky offset below derives from it. */}
      <header className="docs-header sticky top-0 z-50">
        <div className="mx-auto flex h-16 max-w-[84rem] items-center gap-4 px-6">
          <DocsMobileNav />
          <Link
            href="/"
            className="flex flex-shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <Logo />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">
              FurlPay <span className="text-[var(--muted)]">Docs</span>
            </span>
          </Link>
          {/* Hidden below sm: DocsSearch has a 220px min-width that cannot
              shrink, which pushed the header past the viewport on phones.
              Mobile reaches navigation through the hamburger instead. */}
          <div className="mx-auto hidden w-full max-w-md flex-1 justify-center sm:flex">
            <DocsSearch />
          </div>
          <div className="flex-1 sm:hidden" />
          <Link
            href="/dashboard"
            className="btn-green flex-shrink-0 px-4 py-[7px] text-[13px]"
          >
            Open App
          </Link>
        </div>
      </header>

      {/* Body: nav rail / article / on-page ToC.
          Widths are tuned so the article lands near a 70-character measure at
          1440px without leaving a dead gutter: the container tightens as the
          rails widen, rather than the article floating in empty space. */}
      <div className="mx-auto flex max-w-[84rem] gap-10 px-6 lg:gap-12">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 flex-shrink-0 overflow-y-auto py-10 pr-2 md:block">
          <DocsSidebar />
        </aside>
        <main className="min-w-0 flex-1 py-10 md:max-w-[46rem]">
          <Breadcrumbs />
          {children}
        </main>
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 flex-shrink-0 overflow-y-auto py-10 xl:block">
          <DocsToc />
        </aside>
      </div>
    </div>
  );
}

// The official FurlPay mark — the same asset the wallet page uses, so the docs
// header and /wallet present one identity instead of two.
function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand icon in public/, fixed 28px
    <img
      src="/wallet/mark.png"
      alt=""
      aria-hidden="true"
      className="h-7 w-7 flex-shrink-0 rounded-[7px]"
    />
  );
}
