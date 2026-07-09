// ---------------------------------------------------------------------------
// Client-side behavioral collector — the human/agent telemetry that feeds
// lib/services/behavior.ts. Attaches passive listeners, then hands back a
// compact aggregate (never a raw event stream). Pair with the device
// fingerprint and post both in deviceSignals:
//
//   const stop = startBehaviorTracking();
//   // … user fills out and submits the transfer form …
//   const fp = await collectFingerprint();
//   const behavior = stop();
//   fetch("/api/wallets/transfer", {
//     body: JSON.stringify({ …, deviceSignals: { ...fp, visitorId, behavior } }),
//   });
//
// Signals chosen for separability per FP-Agent (arXiv:2605.01247): pointer
// movement vs teleport, keystroke latency + variance, paste/programmatic fill,
// scroll-burst duration. Aggregates only — no keys, text, or coordinates are
// recorded, so nothing sensitive leaves the page.
// ---------------------------------------------------------------------------

import type { BehavioralSignals } from "./services/behavior";

export function startBehaviorTracking(): () => BehavioralSignals {
  const start = Date.now();
  let mouseMoveCount = 0;
  let clickCount = 0;
  let keyDownCount = 0;
  let backspaceCount = 0;
  let pasteCount = 0;
  let charsEntered = 0;
  let movesSinceClick = 0;
  let lastMoveBetweenClicks = 0;

  // Keystroke timing.
  let lastKeyDownAt = 0;
  const interKeyGaps: number[] = [];
  const holdTimes: number[] = [];
  const downAt = new Map<string, number>();

  // Scroll bursts (a burst = scroll activity separated by an idle gap).
  let scrollBurstCount = 0;
  let zeroDurationBursts = 0;
  let burstStart = 0;
  let lastScrollAt = 0;
  const SCROLL_IDLE_MS = 150;

  const onMove = () => {
    mouseMoveCount++;
    movesSinceClick++;
  };
  const onClick = () => {
    clickCount++;
    lastMoveBetweenClicks = movesSinceClick;
    movesSinceClick = 0;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const now = Date.now();
    keyDownCount++;
    if (e.key === "Backspace" || e.key === "Delete") backspaceCount++;
    if (lastKeyDownAt) interKeyGaps.push(now - lastKeyDownAt);
    lastKeyDownAt = now;
    downAt.set(e.code || e.key, now);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const d = downAt.get(e.code || e.key);
    if (d) {
      holdTimes.push(Date.now() - d);
      downAt.delete(e.code || e.key);
    }
  };
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (t && typeof t.value === "string") charsEntered = Math.max(charsEntered, t.value.length);
  };
  const onPaste = () => {
    pasteCount++;
  };
  const onScroll = () => {
    const now = Date.now();
    if (now - lastScrollAt > SCROLL_IDLE_MS) {
      // New burst begins.
      if (burstStart && now - lastScrollAt >= SCROLL_IDLE_MS) {
        // Close the previous burst.
        if (lastScrollAt - burstStart < 16) zeroDurationBursts++;
      }
      scrollBurstCount++;
      burstStart = now;
    }
    lastScrollAt = now;
  };

  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("click", onClick, { passive: true });
  window.addEventListener("keydown", onKeyDown, { passive: true });
  window.addEventListener("keyup", onKeyUp, { passive: true });
  document.addEventListener("input", onInput, { passive: true, capture: true });
  document.addEventListener("paste", onPaste, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, { passive: true });

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const std = (xs: number[]) => {
    if (xs.length < 2) return undefined;
    const m = mean(xs)!;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };

  return function stop(): BehavioralSignals {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("click", onClick);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("input", onInput, { capture: true } as EventListenerOptions);
    document.removeEventListener("paste", onPaste, { capture: true } as EventListenerOptions);
    window.removeEventListener("scroll", onScroll);

    return {
      sessionMs: Date.now() - start,
      mouseMoveCount,
      clickCount,
      moveBetweenClicks: lastMoveBetweenClicks,
      keyDownCount,
      charsEntered,
      pasteCount,
      interKeyMeanMs: mean(interKeyGaps),
      interKeyStdMs: std(interKeyGaps),
      holdMeanMs: mean(holdTimes),
      backspaceCount,
      scrollBurstCount,
      scrollZeroDurationRatio: scrollBurstCount ? zeroDurationBursts / scrollBurstCount : 0,
    };
  };
}
