"use client";

// Owns the one piece of state the nav and the palette share, plus the global
// ⌘K / Ctrl-K binding. Keeping it here means page.tsx stays a Server Component
// and only this small island ships to the browser.

import { useCallback, useEffect, useState } from "react";
import LandingNav from "./LandingNav";
import CommandPalette from "./CommandPalette";

export default function LandingChrome() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      // Claimed everywhere on the page, including inside inputs: ⌘K is the
      // convention developers reach for, and Firefox's "focus the search bar"
      // default is the thing they are trying to avoid.
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = useCallback(() => setPaletteOpen(false), []);

  return (
    <>
      <LandingNav onOpenPalette={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={close} />
    </>
  );
}
