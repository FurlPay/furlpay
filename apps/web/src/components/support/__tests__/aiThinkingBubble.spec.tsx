/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import { AIThinkingBubble, THINKING_PHASES } from "../AIThinkingBubble";

// ---------------------------------------------------------------------------
// The waiting state.
//
// The load-bearing test in this file is the LAST block, and it is not about
// rendering at all: it asserts that no phase label claims work the endpoint
// cannot do. `/api/support/ask` retrieves help articles and optionally writes an
// answer from them. It holds no tools and never reads a balance, a card, a
// ticket or a chain.
//
// The brief this component came from supplied labels like "Verifying Arbitrum
// deposit…" and "Checking card limits & 3DS rules…". Those are capability
// claims, shown to someone waiting to hear what happened to their money. A test
// is the only thing that keeps a plausible-sounding one from being pasted back
// in later.
// ---------------------------------------------------------------------------

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advance the phase timer inside act() so React flushes the state update. */
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("phase progression", () => {
  it("starts on retrieval, which is genuinely what happens first", () => {
    const { container } = render(<AIThinkingBubble />);
    expect(container.textContent).toContain("Searching FurlPay help articles");
  });

  it("moves to generation only after retrieval has had time to return", () => {
    const { container } = render(<AIThinkingBubble />);
    advance(1600);
    expect(container.textContent).toContain("Writing an answer from those articles");
  });

  it("reports a long wait as elapsed time, not as a new step", () => {
    const { container } = render(<AIThinkingBubble />);
    advance(6200);
    // "Still working" is an observable fact. A third *step* would be invented.
    expect(container.textContent).toMatch(/Still working/i);
    expect(container.textContent).toMatch(/taking longer than usual/i);
  });

  it("never goes backwards", () => {
    const { container } = render(<AIThinkingBubble />);
    advance(6200);
    advance(200);
    expect(container.textContent).toMatch(/Still working/i);
  });

  it("clears its interval on unmount", () => {
    const clear = vi.spyOn(globalThis, "clearInterval");
    render(<AIThinkingBubble />).unmount();
    expect(clear).toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("announces the status politely, once", () => {
    const { container } = render(<AIThinkingBubble />);
    const live = container.querySelectorAll('[role="status"]');
    expect(live).toHaveLength(1);
    expect(live[0].getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the dots out of the accessibility tree", () => {
    // Three dots inside the live region would risk announcing each keyframe.
    const { container } = render(<AIThinkingBubble />);
    const dots = container.querySelectorAll(".ai-thinking-dot");
    expect(dots).toHaveLength(3);
    for (const d of dots) expect(d.closest("[aria-hidden]")).not.toBeNull();
  });

  it("animates via a class, never an inline animation", () => {
    // An inline `animation` beats the global prefers-reduced-motion override and
    // kills the opt-out silently. Only the stagger may be inline.
    const { container } = render(<AIThinkingBubble />);
    for (const d of container.querySelectorAll<HTMLElement>(".ai-thinking-dot")) {
      expect(d.style.animation).toBe("");
      expect(d.style.animationName).toBe("");
      expect(d.style.animationDelay).toMatch(/^\d+ms$/);
    }
  });
});

describe("stop", () => {
  it("offers Stop only when there is something to stop", () => {
    const { container } = render(<AIThinkingBubble />);
    expect(within(container).queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("calls onStop when pressed", () => {
    const onStop = vi.fn();
    const { container } = render(<AIThinkingBubble onStop={onStop} />);
    within(container).getByRole("button", { name: "Stop" }).click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("no phase label claims a capability the endpoint does not have", () => {
  const labels = THINKING_PHASES.map((p) => p.label).join(" | ").toLowerCase();

  // Each of these appeared in the source brief's own examples, or names a system
  // the support route provably cannot reach.
  it.each([
    "arbitrum",
    "layer-2",
    "block time",
    "blockchain",
    "on-chain",
    "chain",
    "deposit",
    "balance",
    "card limit",
    "3ds",
    "spending limit",
    "decline reason",
    "transaction",
    "your account",
    "ticket",
    "database",
  ])("never says %s", (forbidden) => {
    expect(labels).not.toContain(forbidden);
  });

  it("uses the word 'verifying' for nothing", () => {
    // We retrieve and we write. We do not verify anything about the customer.
    expect(labels).not.toContain("verif");
  });

  it("describes only retrieval, generation, and elapsed time", () => {
    expect(THINKING_PHASES).toHaveLength(3);
    expect(THINKING_PHASES[0].after).toBe(0);
    // Phases must be ordered, or `reduce` picks the wrong one.
    const ordered = [...THINKING_PHASES].every(
      (p, i, a) => i === 0 || p.after > a[i - 1].after
    );
    expect(ordered).toBe(true);
  });

  it("stays inside the route's own upstream timeout", () => {
    // answer.ts gives the model 12s. A phase that fires after that would be
    // describing a request that has already failed.
    for (const p of THINKING_PHASES) expect(p.after).toBeLessThan(12_000);
  });
});
