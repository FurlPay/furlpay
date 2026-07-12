"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

// "Did this page help?" — one vote per page load, fire-and-forget to the
// feedback counter endpoint. No text collection, no cookies, no tracking.
export default function PageFeedback({ pathname }: { pathname: string }) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  const vote = async (helpful: boolean) => {
    if (voted) return;
    setVoted(helpful ? "up" : "down");
    try {
      await fetch("/api/docs/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: pathname, helpful }),
      });
    } catch {
      /* fire-and-forget */
    }
  };

  if (voted) {
    return <span className="text-[12px] text-textSecondary">Thanks for the feedback.</span>;
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-textSecondary">Did this page help?</span>
      <button
        type="button"
        aria-label="Yes, this page helped"
        onClick={() => vote(true)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="No, this page did not help"
        onClick={() => vote(false)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-textSecondary transition-colors hover:border-red-400/40 hover:text-red-300"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
