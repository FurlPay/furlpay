"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageWindow } from "@/lib/markets/pageWindow";

// ---------------------------------------------------------------------------
// Pagination.
//
// `pageCount` is computed by the server from the REAL filtered total and the
// real page size (lib/markets/table.ts `paginate`), so the pager can never
// offer a page that does not exist — and the last number in the strip is
// whatever the data says it is, not a figure copied from a mockup.
//
// The window is: first page, an ellipsis, a few pages around the current one,
// an ellipsis, last page. Rendering every page as a button is fine at 16 pages
// and unusable at 500.
// ---------------------------------------------------------------------------

export default function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  // One page is not a pager. Rendering "1" alone is chrome that does nothing.
  if (pageCount <= 1) return null;

  const pages = pageWindow(page, pageCount);

  return (
    <nav className="mt-4 flex items-center justify-center gap-1" aria-label="Asset table pages">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] text-textSecondary transition-colors hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-[12px] text-textMuted" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={`h-8 min-w-8 rounded-lg px-2 text-[12px] font-semibold transition-colors font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              p === page
                ? "bg-white text-black"
                : "border border-white/[0.08] text-textSecondary hover:border-white/20 hover:text-white"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] text-textSecondary transition-colors hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
