"use client";

import { useCallback, useEffect, useState } from "react";
import {
  onSavedChange,
  readSavedIds,
  toggleSaved,
  type SavedPlace,
} from "@/lib/hotels/savedPlaces";

// ---------------------------------------------------------------------------
// The save control, and the hook behind it.
//
// The hook exists because the same saved state is rendered in more than one
// place at once — the heart in the detail panel, and the map's Saved filter
// counting the list. Each subscribes to the store rather than being handed a
// prop, so toggling any one of them updates the rest without the map having to
// own and thread wishlist state it does not otherwise care about.
//
// HYDRATION. The set starts EMPTY and fills after mount. Reading localStorage
// while rendering would make the server emit an unsaved heart and the client
// a saved one for the same markup — a mismatch React resolves by throwing away
// the tree. An unfilled heart for one frame is the correct trade.
// ---------------------------------------------------------------------------

/** The ids currently saved, kept in sync with the store. */
export function useSavedIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const sync = () => setIds(readSavedIds());
    sync();
    return onSavedChange(sync);
  }, []);

  return ids;
}

export default function SaveButton({
  place,
  saved,
  size = "md",
  className,
}: {
  place: Omit<SavedPlace, "savedAt">;
  saved: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      // The control sits inside cards that are themselves clickable — a save
      // must not also open the property it saved.
      e.preventDefault();
      e.stopPropagation();
      toggleSaved(place);
    },
    [place]
  );

  const px = size === "sm" ? "h-8 w-8" : "h-9 w-9";

  return (
    <button
      type="button"
      onClick={onClick}
      // The button reports STATE, not the action. A screen reader user needs to
      // know whether this hotel is currently saved; "Save" alone leaves them
      // guessing which way the toggle is pointing.
      aria-pressed={saved}
      aria-label={saved ? `Remove ${place.name} from saved` : `Save ${place.name}`}
      title={saved ? "Saved" : "Save"}
      className={`grid ${px} shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 ${
        saved
          ? "border-transparent bg-[#E85D32] text-white hover:bg-[#d1502a]"
          : "border-white/[0.14] bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white"
      } ${className ?? ""}`}
    >
      {/* Filled when saved, outlined when not. Shape alone carries the state so
          it survives a colour-blind reader and a greyscale screenshot. */}
      <svg
        className={size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"}
        viewBox="0 0 20 20"
        fill={saved ? "currentColor" : "none"}
        aria-hidden
      >
        <path
          d="M10 16.5S3.5 12.6 3.5 8.2A3.7 3.7 0 0 1 10 5.9a3.7 3.7 0 0 1 6.5 2.3c0 4.4-6.5 8.3-6.5 8.3Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
