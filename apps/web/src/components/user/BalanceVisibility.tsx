"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// "Blur balances" — a real setting, not a visual effect.
//
// ── WHY MASK RATHER THAN BLUR ──────────────────────────────────────────────
//
// The obvious implementation is `filter: blur(6px)` over the number. It is the
// wrong one, and dangerously so: a CSS filter changes how a value is PAINTED
// while leaving it in the DOM, in the accessibility tree, and in any screenshot
// tool or screen reader that walks text rather than pixels. Someone shoulder-
// surfing sees a smudge; someone with the element inspector, or a screen
// reader, or a browser extension, reads the number.
//
// So `maskValue` REPLACES the string. What reaches the DOM is bullets. There is
// nothing behind them to recover, which is the only version of this feature
// that means what its name says.
//
// ── WHY IT LIVES IN localStorage AND WHAT THAT COSTS ───────────────────────
//
// It is a per-device display preference, like a collapsed sidebar: someone
// hiding balances on a shared laptop does not want that choice following them
// to their phone. localStorage is therefore correct rather than a shortcut.
//
// The cost is a first-paint problem. The server cannot know the preference, so
// the first render is always "visible" and would flash the real number before
// the effect hides it — the exact frame the feature exists to prevent. `ready`
// is false until the stored value has been read, and `Balance` renders the mask
// until then. Erring toward hidden is the only safe direction for this default.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "furlpay:blur-balances";

/** The mask. Fixed width regardless of the value's length: a mask that is
 *  longer for a larger balance leaks the magnitude it is meant to hide. */
export const MASK = "••••••";

interface BalanceVisibilityValue {
  hidden: boolean;
  /** False until the stored preference has been read on the client. */
  ready: boolean;
  setHidden: (v: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<BalanceVisibilityValue | null>(null);

export function BalanceVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHiddenState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setHiddenState(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode, or storage disabled. The default stands.
    }
    setReady(true);
  }, []);

  const setHidden = useCallback((v: boolean) => {
    setHiddenState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // The preference still applies to this tab; it just will not persist.
    }
  }, []);

  const value = useMemo<BalanceVisibilityValue>(
    () => ({ hidden, ready, setHidden, toggle: () => setHidden(!hidden) }),
    [hidden, ready, setHidden]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the setting.
 *
 * Returns a safe default outside the provider rather than throwing. A missing
 * provider should not blank a page that merely wanted to render a number, and
 * the default is "visible", which is the behaviour every existing screen
 * already has.
 */
export function useBalanceVisibility(): BalanceVisibilityValue {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return { hidden: false, ready: true, setHidden: () => {}, toggle: () => {} };
}

/**
 * Mask a value if the setting says so.
 *
 * For call sites that format their own string and only need the decision.
 */
export function maskValue(value: string, hidden: boolean): string {
  return hidden ? MASK : value;
}

/**
 * A balance, masked when the setting is on.
 *
 * Use this instead of interpolating a formatted number directly, so a new
 * screen is covered by the setting without anyone remembering to wire it.
 */
export function Balance({
  value,
  className = "",
  /** Set when the number is decorative and should not be announced. */
  ariaHidden = false,
}: {
  value: string;
  className?: string;
  ariaHidden?: boolean;
}) {
  const { hidden, ready } = useBalanceVisibility();

  // Hidden until the stored preference is known — see the header. A brief mask
  // on a visible balance is harmless; a brief balance on a masked one is the
  // whole failure.
  const masked = !ready || hidden;

  return (
    <span
      className={className}
      aria-hidden={ariaHidden || undefined}
      aria-label={masked ? "Balance hidden" : undefined}
      // Tabular figures stop the layout jumping as the mask swaps in.
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {masked ? MASK : value}
    </span>
  );
}
