import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The `finally` clause in SupportChatBubble.send().
//
// Two different aborts arrive there and need OPPOSITE handling, which is what
// made the original one-line guard wrong once a user-facing Stop existed:
//
//   supersede  a newer send() aborted the old request. The newer one has
//              already set thinking=true and owns it. Clearing here flickers
//              the indicator off and straight back on.
//   user stop  no successor. If we do not clear, `thinking` stays true: the
//              dots spin forever AND the composer stays disabled, because both
//              the submit button and the send() guard key off `thinking`. The
//              widget is bricked until it remounts.
//
// `!ac.signal.aborted` skipped BOTH, so it was correct only while supersede was
// the only way to abort. `inflight.current === ac` distinguishes them.
//
// Modelled here rather than driven through the component: the property is about
// which controller owns the flag, and a jsdom render of a 740-line widget would
// test far more than that while proving it less directly.
// ---------------------------------------------------------------------------

/** The exact ownership rule from the component's finally clause. */
function runFinally(state: { thinking: boolean; inflight: AbortController | null }, ac: AbortController) {
  if (state.inflight === ac) state.thinking = false;
}

describe("thinking flag ownership on abort", () => {
  it("a user Stop clears the flag, so the composer comes back", () => {
    const ac = new AbortController();
    const state = { thinking: true, inflight: ac };

    ac.abort(); // Stop pressed — nothing supersedes it
    runFinally(state, ac);

    expect(state.thinking).toBe(false);
  });

  it("a supersede leaves the flag alone, so the indicator does not flicker", () => {
    const first = new AbortController();
    const state = { thinking: true, inflight: first };

    // A newer send aborts the first and takes ownership.
    first.abort();
    const second = new AbortController();
    state.inflight = second;
    state.thinking = true;

    runFinally(state, first); // the FIRST request's finally runs late

    expect(state.thinking).toBe(true);
  });

  it("the superseding request still clears the flag when it finishes", () => {
    const ac = new AbortController();
    const state = { thinking: true, inflight: ac };
    runFinally(state, ac);
    expect(state.thinking).toBe(false);
  });

  it("the old guard would have bricked the widget on a user Stop", () => {
    // Kept as an executable record of the regression: this is the previous rule.
    const oldRule = (state: { thinking: boolean }, ac: AbortController) => {
      if (!ac.signal.aborted) state.thinking = false;
    };

    const ac = new AbortController();
    const state = { thinking: true };
    ac.abort();
    oldRule(state, ac);

    // Still true — dots spinning, composer disabled, no way back.
    expect(state.thinking).toBe(true);
  });
});
