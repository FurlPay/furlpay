"use client";

import { useState } from "react";
import DocsSidebar from "@/components/docs/DocsSidebar";

// Mobile docs navigation: hamburger in the header opens a slide-over with the
// full sidebar. Hidden at md+ where the persistent rail takes over.

export default function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close docs navigation" : "Open docs navigation"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-textSecondary transition-colors hover:text-white"
      >
        {open ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 top-[57px] z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 left-0 top-[57px] z-50 w-72 overflow-y-auto border-r border-white/10 bg-oled p-5">
            <DocsSidebar onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
