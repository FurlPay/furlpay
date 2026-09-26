import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerHaptic, type HapticType } from "../hapticsAndAudio";

// ---------------------------------------------------------------------------
// Haptics as progressive enhancement.
//
// The only thing that genuinely matters here is that haptics can NEVER break the
// action they accompany. A payment must not fail because a phone has no vibration
// motor, because the user disabled it, or because the browser threw.
//
// Playwright cannot prove a phone physically vibrated, and neither can this file.
// What is tested is the CONTRACT: called once per event, silent when unsupported,
// and swallowing its own failures. Physical output needs device-level checking.
// ---------------------------------------------------------------------------

const ALL: HapticType[] = [
  "light",
  "medium",
  "heavy",
  "selection",
  "scanLock",
  "success",
  "error",
  "wobbleShake",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Install a navigator whose `vibrate` we control. */
function withVibrate(impl: (pattern: number | number[]) => boolean) {
  const vibrate = vi.fn(impl);
  vi.stubGlobal("navigator", { vibrate } as unknown as Navigator);
  return vibrate;
}

describe("a device that supports vibration", () => {
  it("calls vibrate exactly once per event", () => {
    const vibrate = withVibrate(() => true);
    triggerHaptic("success");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("does not fire repeatedly for a single call", () => {
    // Guards the React trap: a haptic driven from a render-time effect fires on
    // every re-render and turns feedback into noise. One call, one buzz.
    const vibrate = withVibrate(() => true);
    triggerHaptic("selection");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("every event produces a pattern", () => {
    for (const type of ALL) {
      const vibrate = withVibrate(() => true);
      triggerHaptic(type);
      expect(vibrate, `${type} produced no haptic`).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it("outcomes that mean opposite things do not feel the same", () => {
    // The distinction that carries information. `error` and `wobbleShake`
    // deliberately SHARE a pattern — both are failure feedback — so this asserts
    // the meaningful pairs differ rather than demanding all eight be unique.
    const patternOf = (type: HapticType) => {
      const vibrate = withVibrate(() => true);
      triggerHaptic(type);
      const p = JSON.stringify(vibrate.mock.calls[0][0]);
      vi.unstubAllGlobals();
      return p;
    };

    expect(patternOf("success")).not.toBe(patternOf("error"));
    expect(patternOf("selection")).not.toBe(patternOf("success"));
    expect(patternOf("selection")).not.toBe(patternOf("error"));
    // The three intensity steps must actually differ, or the scale is cosmetic.
    expect(new Set([patternOf("light"), patternOf("medium"), patternOf("heavy")]).size).toBe(3);
  });

  it("keeps every pattern short enough to read as feedback", () => {
    // A long buzz reads as an alarm. Total duration stays well under a second.
    for (const type of ALL) {
      const vibrate = withVibrate(() => true);
      triggerHaptic(type);
      const arg = vibrate.mock.calls[0][0];
      const total = Array.isArray(arg) ? arg.reduce((a, b) => a + b, 0) : arg;
      expect(total, `${type} is too long`).toBeLessThanOrEqual(400);
      vi.unstubAllGlobals();
    }
  });
});

describe("a device that does not", () => {
  it("is silent when navigator has no vibrate", () => {
    vi.stubGlobal("navigator", {} as unknown as Navigator);
    for (const type of ALL) expect(() => triggerHaptic(type)).not.toThrow();
  });

  it("is silent server-side, where navigator does not exist", () => {
    // These helpers sit in lib/ and can be imported by a module that also runs on
    // the server; a bare `navigator` reference there is a 500.
    vi.stubGlobal("navigator", undefined);
    for (const type of ALL) expect(() => triggerHaptic(type)).not.toThrow();
  });
});

describe("when vibration itself fails", () => {
  it.each([
    ["throws a SecurityError", () => { throw new DOMException("blocked", "SecurityError"); }],
    ["throws a plain Error", () => { throw new Error("no motor"); }],
    ["returns false", () => false],
  ])("swallows the failure when vibrate %s", (_label, impl) => {
    // THE PROPERTY THAT MATTERS: the caller is mid-payment. A haptic failure must
    // never surface as an exception that aborts the transfer.
    withVibrate(impl as (p: number | number[]) => boolean);
    for (const type of ALL) expect(() => triggerHaptic(type)).not.toThrow();
  });

  it("a failed haptic does not stop the code after it", () => {
    withVibrate(() => { throw new Error("blocked"); });
    let reached = false;
    const action = () => {
      triggerHaptic("success");
      reached = true;
    };
    expect(action).not.toThrow();
    expect(reached).toBe(true);
  });
});

describe("unknown event types", () => {
  it("does nothing rather than guessing a pattern", () => {
    const vibrate = withVibrate(() => true);
    triggerHaptic("not-a-real-event" as HapticType);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
