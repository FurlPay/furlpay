"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";

// Error boundary for the whole /markets subtree.
//
// Without one, a throw anywhere in this client tree escapes to the ROOT
// boundary and replaces the entire application shell — the reader loses the
// navigation along with the page, and the only way back is the browser's back
// button. Scoping it here keeps the failure inside the surface that failed.
//
// WHAT THIS DELIBERATELY DOES NOT SAY. No "something went wrong" with a stack
// trace, and no invented diagnosis. A market page that cannot render is, from
// the reader's side, a page whose prices they should not act on — so the copy
// says exactly that and offers the two things that actually help: retry, or go
// somewhere that works. `error.digest` is the server-side correlation id and is
// the one detail worth surfacing, because it is what makes a support
// conversation possible.

export default function MarketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the browser console and any attached error reporter. Deliberately
    // console.error rather than a silent swallow: a markets page failing to
    // render is worth a line in whatever is watching.
    console.error("markets route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-oled px-5">
      <div className="surface-card w-full max-w-[440px] p-7 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-loss/10">
          <TriangleAlert className="h-5 w-5 text-loss" aria-hidden />
        </span>

        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-textPrimary">
          Markets couldn&apos;t load
        </h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-textSecondary">
          Prices and positions on this page are unavailable right now. Nothing was
          bought or sold, and no figure shown before this is safe to act on until it
          reloads.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={reset}
            className="tap flex w-full items-center justify-center gap-2 rounded-pill bg-accent py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="tap w-full rounded-pill border border-white/[0.12] py-3 text-[14px] font-semibold text-textSecondary transition-colors hover:border-white/25 hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
          >
            Back to dashboard
          </Link>
        </div>

        {error.digest && (
          <p className="mt-4 font-mono text-[10.5px] text-textMuted">
            Reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
