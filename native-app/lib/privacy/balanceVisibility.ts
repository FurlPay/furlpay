import { useSyncExternalStore } from "react";
import { prefGet, prefSet } from "@/lib/db";
import { track } from "@/lib/analytics";

// ---------------------------------------------------------------------------
// The balance privacy toggle.
//
// WHAT IT IS FOR, precisely: someone is about to hand their phone to a
// colleague, or is on a train, or is being filmed. It hides a NUMBER from a
// person standing nearby. It is not a security control — anyone holding an
// unlocked phone can tap the eye — and the app-lock in app/_layout.tsx is what
// actually protects a backgrounded session.
//
// STORED IN device_prefs, WHICH SURVIVES SIGN-OUT, and that is correct: it is a
// preference of the PERSON HOLDING THE PHONE, exactly like theme and language,
// not a fact about an account. The one thing device_prefs must never hold is
// account-scoped data (dbClassification.test.ts guards that), and a boolean
// about whether to render digits is not.
//
// ONE SOURCE OF TRUTH FOR THE WHOLE APP. The obvious alternative — local state
// on each screen — means hiding the balance on Home and finding it visible on
// Cards, which is worse than no feature at all: the user believes they are
// covered and they are not. useSyncExternalStore keeps every mounted balance in
// lockstep with no provider to forget to mount.
//
// MASKING HAPPENS AT RENDER, NEVER AT FETCH. The value is still loaded, still
// cached and still correct — only the glyphs change. Refusing to fetch while
// hidden would mean unhiding shows a spinner, and would break every derived
// figure (totals, charts, sort orders) that has nothing to do with privacy.
// ---------------------------------------------------------------------------

const PREF_KEY = "privacy.balancesHidden";

let hidden = readInitial();
const listeners = new Set<() => void>();

function readInitial(): boolean {
  try {
    return prefGet(PREF_KEY) === "1";
  } catch {
    // A preference read failing must not stop the app rendering. Visible is the
    // right default: a user who never asked for this should not open the app to
    // masked balances and no idea why.
    return false;
  }
}

export function balancesHidden(): boolean {
  return hidden;
}

export function setBalancesHidden(next: boolean): void {
  if (hidden === next) return;
  hidden = next;
  try {
    prefSet(PREF_KEY, next ? "1" : "0");
  } catch {
    // The in-memory value still changed, so the toggle works for this session
    // even if it will not survive a restart. Failing the toggle because a write
    // failed would be the worse outcome — the user asked for the number gone
    // now.
  }
  track("balances_hidden", { hidden: next });
  for (const l of listeners) l();
}

export function toggleBalancesHidden(): void {
  setBalancesHidden(!hidden);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Subscribe a component to the toggle.
 *
 * Returns the flag and the toggler together so a call site cannot end up
 * reading the shared value while writing a local one.
 */
export function useBalancesHidden(): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => hidden,
    () => false,
  );
  return [value, toggleBalancesHidden];
}

/** Test seam. */
export function __resetBalanceVisibilityForTest(): void {
  hidden = false;
  listeners.clear();
}
