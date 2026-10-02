// ---------------------------------------------------------------------------
// Payment network marks, as inline SVG (no network request, no layout shift).
//
// SOURCES
//   Visa        the Visa wordmark path from Simple Icons 13.21.0 (CC0 artwork;
//               the trademark is Visa's). Rendered white on a dark tile, the
//               reversed form Visa permits on dark backgrounds. The viewBox is
//               cropped to the wordmark so its proportions are the real ones.
//
// NO MASTERCARD / AMEX MARK, deliberately. Travel checkout has no card
// processor, and the virtual cards FurlPay issues are Visa (lib/cards/
// rainAdapter.ts, network: "Visa"). When card acceptance is connected, add the
// Mastercard symbol at its official geometry: two equal circles, red #EB001B
// and yellow #F79E1B, overlap #FF5F00, width ≈ 1.62 × height (centres 0.62
// diameters apart). Amex only if the processor account enables it.
//
// RULE: render a mark only where the code path really involves that network.
// Each mark is role="img" with an accessible name; never decorative.
// ---------------------------------------------------------------------------

const VISA_PATH =
  "M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z";

/** A uniform tile so marks of different shapes line up at one height. */
function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-[5px] border border-white/[0.12] bg-white/[0.06]"
    >
      {children}
    </span>
  );
}

export function VisaMark({ label = "Visa" }: { label?: string }) {
  return (
    <Tile label={label}>
      <svg viewBox="0 8 24 8" className="h-[9px] w-auto" aria-hidden focusable="false">
        <path d={VISA_PATH} fill="#FFFFFF" />
      </svg>
    </Tile>
  );
}
