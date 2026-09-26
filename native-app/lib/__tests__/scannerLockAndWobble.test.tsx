import { readFileSync } from "fs";
import { join } from "path";
import React from "react";
import TestRenderer, { act, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { ScannerFrame, LOCK_SNAP_MS } from "@/components/ScannerFrame";
import { WobbleView, WOBBLE_DURATION_MS } from "@/components/ui/WobbleView";
import { haptic } from "@/lib/haptics";

jest.mock("@/lib/haptics", () => ({
  haptic: {
    tap: jest.fn(),
    select: jest.fn(),
    found: jest.fn(),
    commit: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Scanner target-lock and the error wobble.
//
// Both are feedback, which makes them easy to get wrong in a way no one notices:
// motion that says the wrong thing is worse than no motion, because the user
// acts on it. So these tests are about MEANING, not about frames:
//
//   * the scanner acknowledges a recognised code, and does NOT acknowledge one
//     that holds no payment;
//   * the wobble fires for the same error twice (a user who retries unchanged
//     must still get feedback);
//   * neither is the only signal — the text and the haptic carry it too.
//
// What they cannot test is whether the animation looks right. That needs a
// device, and is called out as unverified.
// ---------------------------------------------------------------------------

const src = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

afterEach(() => jest.clearAllMocks());

describe("ScannerFrame — seeking vs locked", () => {
  it("renders the sweep line while seeking", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ScannerFrame />);
    });
    // The line is the only element that animates translateY.
    const animated = tree.root.findAll(
      (n: ReactTestInstance) =>
        typeof n.type !== "string" && JSON.stringify(n.props?.style ?? "").includes("translateY"),
      { deep: true }
    );
    expect(animated.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("removes the sweep line once locked", () => {
    // Not merely faded: an invisible element still animating is work done for
    // nothing on a screen that is about to unmount.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ScannerFrame locked />);
    });
    const withTranslateY = tree.root.findAll(
      (n: ReactTestInstance) => JSON.stringify(n.props?.style ?? "").includes("translateY"),
      { deep: true }
    );
    expect(withTranslateY).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("is reversible — an unpayable code reopens the frame", () => {
    // A scan that turns out to hold no payment resets `locked`, and the frame
    // must go back to seeking rather than staying clamped on nothing.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ScannerFrame locked />);
    });
    act(() => {
      tree.update(<ScannerFrame locked={false} />);
    });
    const withTranslateY = tree.root.findAll(
      (n: ReactTestInstance) => JSON.stringify(n.props?.style ?? "").includes("translateY"),
      { deep: true }
    );
    expect(withTranslateY.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("does not animate borderColor", () => {
    // React Native cannot animate borderColor on the native driver; doing so
    // silently drops the whole animation to the JS thread and stutters. The
    // colour must change via a plain conditional style.
    const code = src("components/ScannerFrame.tsx");
    expect(code).not.toMatch(/borderColor:\s*\w+\.interpolate/);
    expect(code).toContain("bracketLocked");
  });

  it("publishes the snap duration so the caller can wait for it", () => {
    // scan.tsx delays navigation by exactly this. A hard-coded 180 in two files
    // is a number that drifts.
    expect(LOCK_SNAP_MS).toBe(180);
  });
});

describe("scan.tsx — acknowledges before it navigates", () => {
  const code = src("app/scan.tsx");

  it("waits for the snap before routing", () => {
    expect(code).toContain("setTimeout(go, LOCK_SNAP_MS)");
  });

  it("clears the pending navigation on unmount", () => {
    // Backing out during the 180ms window would otherwise fire router.replace
    // from an unmounted screen and yank the user to a route they had left.
    expect(code).toContain("clearTimeout(snapTimer.current)");
  });

  it("fires 'found', never 'success', on recognition", () => {
    // Nothing has been paid at this point. A success buzz here would confirm a
    // payment that has not happened.
    expect(code).toContain("haptic.found()");
    expect(code).not.toContain("haptic.success()");
  });

  it("locks on every payable branch and none of the unpayable ones", () => {
    // Four payable outcomes: WalletConnect, UPI, SGQR, plain address.
    expect(code.match(/lockThenGo\(/g) ?? []).toHaveLength(4);
    // The failure branches set an error and leave the frame sweeping.
    expect(code).toContain('setInvalid("not_payable")');
    expect(code).not.toMatch(/setInvalid[\s\S]{0,80}setLocked\(true\)/);
  });

  it("latches so a second camera frame cannot navigate twice", () => {
    expect(code).toContain("if (handled.current) return;");
    expect(code).toMatch(/lockThenGo = \([\s\S]{0,120}handled\.current = true;/);
  });
});

describe("WobbleView — refusal feedback", () => {
  it("does not wobble on first render", () => {
    act(() => {
      TestRenderer.create(
        <WobbleView triggerKey={null}>
          <></>
        </WobbleView>
      );
    });
    expect(haptic.error).not.toHaveBeenCalled();
  });

  it("wobbles and buzzes when the key changes", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WobbleView triggerKey={null}>
          <></>
        </WobbleView>
      );
    });
    act(() => {
      tree.update(
        <WobbleView triggerKey="insufficient-balance">
          <></>
        </WobbleView>
      );
    });
    expect(haptic.error).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("does NOT re-wobble when a parent re-renders with the same key", () => {
    // Any unrelated state change during an error would otherwise restart the
    // animation and buzz again, turning one refusal into a stutter.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WobbleView triggerKey="err-1">
          <></>
        </WobbleView>
      );
    });
    act(() => {
      tree.update(
        <WobbleView triggerKey="err-1">
          <></>
        </WobbleView>
      );
    });
    expect(haptic.error).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("wobbles again for a DIFFERENT key", () => {
    // The reason triggerKey is not a boolean: a user who corrects nothing and
    // retries must still get feedback, or the button looks broken.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WobbleView triggerKey={1}>
          <></>
        </WobbleView>
      );
    });
    act(() => {
      tree.update(
        <WobbleView triggerKey={2}>
          <></>
        </WobbleView>
      );
    });
    expect(haptic.error).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("can wobble silently when the caller already buzzed", () => {
    act(() => {
      TestRenderer.create(
        <WobbleView triggerKey="x" withHaptic={false}>
          <></>
        </WobbleView>
      );
    });
    expect(haptic.error).not.toHaveBeenCalled();
  });

  it("animates only translateX, on the native driver", () => {
    const code = src("components/ui/WobbleView.tsx");
    expect(code).toContain("useNativeDriver: true");
    expect(code).toContain("translateX: shake");
    // Animating width/left/margin would reflow the page around the error.
    expect(code).not.toMatch(/toValue:.*\n.*(width|left|marginLeft):/);
  });

  it("ends at exactly 0 so nothing is left displaced", () => {
    const code = src("components/ui/WobbleView.tsx");
    const last = [...code.matchAll(/toValue: (-?\d+), duration/g)].pop();
    expect(last?.[1]).toBe("0");
  });

  it("decays rather than repeating, and settles inside a third of a second", () => {
    // A constant-amplitude shake reads as an alarm; a looping one as a broken
    // screen.
    const code = src("components/ui/WobbleView.tsx");
    const peaks = [...code.matchAll(/toValue: (-?\d+), duration/g)].map((m) => Math.abs(Number(m[1])));
    const magnitudes = peaks.slice(0, -1);
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i]).toBeLessThan(magnitudes[i - 1]);
    }
    expect(code).not.toContain("Animated.loop");
    expect(WOBBLE_DURATION_MS).toBeLessThanOrEqual(350);
  });

  it("stops the animation on unmount", () => {
    const code = src("components/ui/WobbleView.tsx");
    expect(code).toMatch(/return \(\) => \{[\s\S]{0,120}animation\.stop\(\)/);
  });
});

describe("WobbleView — reduce motion", () => {
  const code = src("components/ui/WobbleView.tsx");

  it("consults the OS setting", () => {
    expect(code).toContain("AccessibilityInfo.isReduceMotionEnabled()");
  });

  it("watches for changes rather than reading once", () => {
    // The user can turn it on in Settings without restarting the app.
    expect(code).toContain('addEventListener("reduceMotionChanged"');
    expect(code).toContain("sub.remove()");
  });

  it("KEEPS the haptic when motion is suppressed", () => {
    // The critical half. Reduce motion exists because movement itself is
    // unpleasant for vestibular disorders — not because the user wants less
    // information. Dropping the buzz too would leave them with no feedback and
    // trade one accessibility problem for another.
    const effect = code.slice(code.indexOf("if (lastKey.current === triggerKey) return;"));
    const hapticAt = effect.indexOf("haptic.error()");
    const bailAt = effect.indexOf("if (reduceMotionRef.current) return;");
    expect(hapticAt).toBeGreaterThan(-1);
    expect(bailAt).toBeGreaterThan(-1);
    // The haptic must come FIRST, or the early return skips it.
    expect(hapticAt).toBeLessThan(bailAt);
  });

  it("still renders children, so the error text survives", () => {
    expect(code).toMatch(/if \(reduceMotion\) return <Animated\.View style=\{style\}>\{children\}/);
  });

  it("defaults to motion allowed if the read fails", () => {
    // A silent read error must not quietly disable feedback for everyone.
    expect(code).toContain("useState(false)");
    expect(code).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it("reads the flag from a ref inside the effect", () => {
    // Listing reduceMotion as a dependency would re-run the effect when the user
    // toggles the setting mid-error, and re-buzz for an error already reported.
    expect(code).toContain("reduceMotionRef.current");
    expect(code).toMatch(/\}, \[triggerKey, withHaptic, shake\]\)/);
  });
});

describe("send.tsx — the wobble is wired to real validation failures", () => {
  const code = src("app/(tabs)/send.tsx");

  it("wraps both error surfaces", () => {
    expect(code.match(/<WobbleView/g) ?? []).toHaveLength(2);
  });

  it("keys on the message, not a boolean", () => {
    // A boolean would give no feedback on a second identical failure.
    expect(code.match(/triggerKey=\{exec\.error\}/g) ?? []).toHaveLength(2);
  });

  it("leaves no un-wrapped exec error on the send path", () => {
    // Every exec.error surface is inside a WobbleView. Asserted by pairing counts
    // rather than by matching a bare line — the ErrorNote is still on its own
    // line, just nested, so a line-anchored regex proves nothing either way.
    const notes = code.match(/<ErrorNote message=\{exec\.error\}/g) ?? [];
    const wraps = code.match(/<WobbleView triggerKey=\{exec\.error\}>/g) ?? [];
    expect(notes.length).toBeGreaterThan(0);
    expect(wraps).toHaveLength(notes.length);

    // And each wrapper actually contains the note it is paired with.
    for (const m of code.matchAll(/<WobbleView triggerKey=\{exec\.error\}>([\s\S]{0,160}?)<\/WobbleView>/g)) {
      expect(m[1]).toContain("<ErrorNote message={exec.error}");
    }
  });
});

describe("SwipeToConfirm — milestone haptics", () => {
  const code = src("components/money/SwipeToConfirm.tsx");

  it("uses the app's haptic vocabulary, not raw expo-haptics", () => {
    expect(code).toContain('from "@/lib/haptics"');
    expect(code).not.toContain("expo-haptics");
    expect(code).not.toContain("Haptics.");
  });

  it("ticks at the start, the midpoint and the commit threshold", () => {
    expect(code).toContain("haptic.tap()"); // grant
    expect(code).toContain("haptic.select()"); // 50%
    expect(code).toContain("haptic.commit()"); // 75%
  });

  it("does NOT fire success on release", () => {
    // The defect this replaced: notificationAsync(Success) fired the instant the
    // thumb lifted, so a payment later declined had already been celebrated.
    // Success belongs to whoever observes the server's answer.
    // Comments stripped first: the code EXPLAINS where success belongs and names
    // haptic.success() while doing so, and a test that fails on its own
    // documentation is one people learn to ignore.
    const commitFn = code
      .slice(code.indexOf("const commit = useCallback"), code.indexOf("const responder"))
      .replace(/\/\/.*$/gm, "");
    expect(commitFn).not.toContain("haptic.success");
  });

  it("latches each milestone so it fires once per drag", () => {
    expect(code).toContain("passedMidpoint.current = true");
    expect(code).toContain("passedThreshold.current = true");
  });

  it("resets BOTH latches on spring-back", () => {
    // Resetting only the threshold left the midpoint latched, so a retry after an
    // abort was silent through the first half of the track.
    const springBack = code.slice(code.indexOf("const springBack"), code.indexOf("// Reset whenever"));
    expect(springBack).toContain("passedThreshold.current = false");
    expect(springBack).toContain("passedMidpoint.current = false");
  });

  it("still rubber-bands past the end of the track", () => {
    expect(code).toContain("travel + (next - travel) / 6");
  });
});
