"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// The "thinking" state for the support assistant.
//
// It replaces a bare "AI is thinking…" line. On a financial support page a wait
// with no explanation reads as a failure — people ask whether the app froze or
// whether their money moved — so the wait says what is happening.
//
// WHAT IT SAYS IS CONSTRAINED BY WHAT WE ACTUALLY DO, and that is the whole
// design of this file.
//
// `POST /api/support/ask` does exactly two things: `retrieveKb()` over the help
// articles that ship in kb.ts, then (only when a model key is set) one
// completion grounded on what came back. It holds no tools. It never reads a
// balance, a card, a ticket or a chain.
//
// So these labels are honest, and the ones in the brief this came from were not:
// "Verifying Arbitrum deposit…", "Verifying Layer-2 block times…", "Checking
// card limits & 3DS rules…", "Analyzing decline reason…" all describe work this
// endpoint cannot perform. Printing them would invent a capability — and it
// would do it in the most damaging place, on a customer waiting to find out
// what happened to their money. A progress step is a claim.
//
// For the same reason there is no `steps?: string[]` prop. The brief had one,
// and its own example filled it with "Verifying blockchain status…". A free-form
// label slot is the mechanism by which a fabricated step gets shipped by
// somebody in a hurry; a closed component cannot be handed a lie.
//
// The phases below are the only things a client can truthfully know:
// retrieval happens first, generation happens after, and elapsed time is
// directly observable.
// ---------------------------------------------------------------------------

/** Honest phases. Retrieval really is first; the rest is measured, not claimed. */
const PHASES = [
  // 0 – 1.4s. True for every request: retrieval always runs first, and with no
  // model key the answer is extracted from these same articles.
  { after: 0, label: "Searching FurlPay help articles…" },
  // 1.4s+. If we are still waiting this long, retrieval returned and a model
  // call is in flight — with no key the whole route answers in milliseconds and
  // this phase is never reached.
  { after: 1400, label: "Writing an answer from those articles…" },
  // 6s+. Observable fact, not a step. The route's own upstream timeout is 12s.
  { after: 6000, label: "Still working — this is taking longer than usual." },
] as const;

export function AIThinkingBubble({ onStop }: { onStop?: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    // 200ms: fine enough to switch phase promptly, coarse enough that this is
    // not a render loop behind a network wait.
    const t = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(t);
  }, []);

  const phase = PHASES.reduce((best, p) => (elapsed >= p.after ? p : best), PHASES[0]);

  return (
    <div className="flex items-start gap-2.5">
      {/* Same dashed-outline Sparkles identity the assistant uses everywhere
          else, so the waiting state is visibly the AI and not a human agent
          about to type. */}
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 bg-white/[0.04]">
        <Sparkles className="h-3.5 w-3.5 text-textSecondary" aria-hidden />
      </span>

      <div className="flex flex-col gap-1.5 rounded-2xl rounded-tl-sm border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5">
        {/*
          One live region for the whole bubble.

          `aria-live="polite"` waits for a pause rather than interrupting, and
          the region wraps only the label — if it wrapped the dots too, every
          keyframe risks being announced as a change. The dots are decoration.
        */}
        <span role="status" aria-live="polite" className="text-[12.5px] text-textSecondary">
          {phase.label}
        </span>

        <div className="flex items-center gap-1.5">
          {/* aria-hidden goes on the DOTS ONLY. It was briefly on this whole
              row, which took the Stop button out of the accessibility tree with
              it — a control a screen-reader user could not find, and the one
              control that matters most while waiting. */}
          <span className="flex items-center gap-1.5" aria-hidden>
            {[0, 180, 360].map((delay) => (
              <span
                key={delay}
                className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-neon shadow-[0_0_8px_rgba(0,229,153,0.45)]"
                // Only the stagger is inline. The animation itself is a class so
                // the global prefers-reduced-motion override can still win.
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>

          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="ml-2.5 rounded text-[11px] text-textSecondary underline transition-colors hover:text-white"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Exported for tests — the phase labels are a claim surface, so they are pinned. */
export const THINKING_PHASES = PHASES;
