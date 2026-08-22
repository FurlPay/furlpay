// Marks that lucide doesn't carry (or carries in the wrong orientation) for the
// /trips composition. Everything else on the page uses lucide-react directly.

/**
 * Top-down airliner silhouette in a 24x24 box, nose pointing UP. Exported as
 * raw path data so route diagrams can drop it into a `<g transform>` at any
 * angle and scale without nesting an `<svg>` inside an `<svg>`.
 */
export const PLANE_PATH =
  "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z";

/** The same silhouette as a standalone element, rotated nose-right. */
export function PlaneGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path transform="rotate(90 12 12)" d={PLANE_PATH} />
    </svg>
  );
}

/** USDC — blue disc, white ring, white dollar glyph. */
export function UsdcCoin({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="USD Coin"
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <circle cx="16" cy="16" r="11.6" fill="none" stroke="#fff" strokeWidth="1.5" />
      <path
        d="M16 8.6v1.5c2 .2 3.4 1.3 3.7 3.1h-2c-.2-.9-.9-1.5-2.2-1.5-1.3 0-2 .55-2 1.35 0 .75.45 1.15 2.1 1.4 2.55.4 4.2 1.1 4.2 3.3 0 1.85-1.35 3-3.8 3.25V22h-1.6v-1.5c-2.2-.25-3.65-1.4-3.95-3.25h2c.2 1 1 1.65 2.5 1.65 1.5 0 2.25-.6 2.25-1.45 0-.85-.5-1.25-2.3-1.55-2.6-.4-3.95-1.2-3.95-3.15 0-1.75 1.3-2.9 3.45-3.15V8.6H16Z"
        fill="#fff"
      />
    </svg>
  );
}

/** The Apple Wallet app icon: stacked cards behind a notched front pocket. */
export function AppleWalletIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 32" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="39" height="31" rx="5.5" fill="#FDFDFD" />
      {/* Card stack. The blue card is the rounded base and the rest are plain
          bands sitting inside its straight-sided middle, so the stack needs no
          <clipPath> — and therefore no document-global id to collide on. */}
      <rect x="3" y="3" width="34" height="26" rx="3" fill="#3B87D8" />
      <rect x="3" y="9" width="34" height="5" fill="#F2CE1B" />
      <rect x="3" y="14" width="34" height="5" fill="#3FA85C" />
      <rect x="3" y="19" width="34" height="7" fill="#E0674F" />
      {/* front pocket, with the wallet's signature centre dip */}
      <path
        d="M1.5 31.5h37V17.5c0-.6-.5-1-1-1H25.4c-.7 0-1.2.5-1.4 1.1-.6 2-2.2 3.2-4 3.2s-3.4-1.2-4-3.2c-.2-.6-.7-1.1-1.4-1.1H2.5c-.6 0-1 .4-1 1z"
        fill="#D9D9D9"
      />
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="31"
        rx="5.5"
        fill="none"
        stroke="rgba(0,0,0,0.14)"
      />
    </svg>
  );
}
