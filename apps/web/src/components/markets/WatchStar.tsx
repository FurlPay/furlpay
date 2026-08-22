"use client";

import { Star } from "lucide-react";

// ---------------------------------------------------------------------------
// The star on every asset row.
//
// A real <button>, not a clickable div wrapped in a link. It sits INSIDE a row
// that is itself a link to the asset, so both the click and the keypress have
// to stop propagating — otherwise starring an asset also navigates away from
// the table, which is the opposite of what a "keep this where I can see it"
// control should do.
//
// `aria-pressed` rather than a label that changes: a screen reader announces
// the toggle state without the button renaming itself under the user.
// ---------------------------------------------------------------------------

export default function WatchStar({
  symbol,
  starred,
  onToggle,
  size = 16,
  className,
}: {
  symbol: string;
  starred: boolean;
  onToggle: (symbol: string) => void;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={starred ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(symbol);
      }}
      onKeyDown={(e) => {
        // Enter inside a link row would follow the link. Claim both keys.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-mkt-cyan ${
        starred ? "text-amber-300" : "text-white/25 hover:text-white/60"
      } ${className ?? ""}`}
    >
      <Star
        style={{ width: size, height: size }}
        strokeWidth={starred ? 2 : 1.75}
        fill={starred ? "currentColor" : "none"}
      />
    </button>
  );
}
