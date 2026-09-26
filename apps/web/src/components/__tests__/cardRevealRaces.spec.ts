import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Race conditions around the card reveal gate.
//
// Every defect below was introduced by the timeout that fixed the "stuck
// forever" bug — bounding an unbounded promise creates a second promise that can
// also win, and that is where the new failure modes live. They are modelled here
// rather than driven through the component because each is about WHICH PROMISE
// SETTLES FIRST, which a jsdom render cannot control precisely and a browser
// cannot control at all.
//
// The invariant under all of them: a ceremony that did not finish, finished late,
// or finished after the card went away must NEVER open the card.
// ---------------------------------------------------------------------------

const PAGE = readFileSync(join(__dirname, "..", "..", "app", "cards", "page.tsx"), "utf8");
const CARD = readFileSync(join(__dirname, "..", "Realistic3DCard.tsx"), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * The gate's logic, mirrored exactly from cards/page.tsx so the race can be
 * driven with fake timers. The assertions below pin the SOURCE to this shape, so
 * the model cannot silently drift from the implementation.
 */
function makeGate(authenticate: () => Promise<boolean>, available = true) {
  return async function requestCardStepUp(): Promise<boolean> {
    try {
      if (!available) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ceremony = authenticate().catch(() => false);
      try {
        return await Promise.race([
          ceremony,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 60_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      return false;
    }
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("a ceremony that never settles", () => {
  it("resolves false at the bound instead of hanging", async () => {
    // The original defect: navigator.credentials.get() can hang with no prompt,
    // no rejection and no timeout of its own.
    const gate = makeGate(() => new Promise<boolean>(() => {}));
    const result = gate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
  });

  it("does not resolve early", async () => {
    const gate = makeGate(() => new Promise<boolean>(() => {}));
    let settled = false;
    void gate().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(settled).toBe(false);
  });
});

describe("a ceremony that finishes AFTER the timeout", () => {
  it("cannot retroactively open the card", async () => {
    // The dangerous direction. The caller was told "no" and moved on; a late
    // success must not arrive and authorise anything.
    const gate = makeGate(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 90_000))
    );
    const result = gate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);

    // The late success lands with nobody waiting; the answer stays false.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await result).toBe(false);
  });

  it("a late REJECTION does not become an unhandled rejection", async () => {
    // Once the timeout wins nothing awaits the ceremony. Without the pre-attached
    // .catch, a later rejection surfaces as an unhandled rejection — a dev error
    // overlay, and a logged crash in production.
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | { reason?: unknown }) =>
      unhandled.push((e as { reason?: unknown }).reason);
    process.on("unhandledRejection", onUnhandled);

    const gate = makeGate(
      () =>
        new Promise<boolean>((_resolve, reject) =>
          setTimeout(() => reject(new Error("user dismissed a stuck prompt")), 90_000)
        )
    );
    const result = gate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);

    await vi.advanceTimersByTimeAsync(40_000);
    await Promise.resolve();
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

describe("the happy path is not penalised", () => {
  it("returns true immediately when the ceremony succeeds", async () => {
    const gate = makeGate(async () => true);
    expect(await gate()).toBe(true);
  });

  it("clears the timer, so a success does not pin one for 60s", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const gate = makeGate(async () => true);
    await gate();
    expect(clear).toHaveBeenCalled();
  });

  it("a rejected ceremony is a refusal, not a throw", async () => {
    const gate = makeGate(async () => {
      throw new Error("NotAllowedError");
    });
    await expect(gate()).resolves.toBe(false);
  });

  it("no authenticator means no ceremony at all", async () => {
    const authenticate = vi.fn(async () => true);
    const gate = makeGate(authenticate, false);
    expect(await gate()).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("the source matches the model above", () => {
  const gate = code(PAGE).slice(
    code(PAGE).indexOf("const requestCardStepUp"),
    code(PAGE).indexOf("const loadTxs")
  );

  it("attaches the rejection handler BEFORE racing", () => {
    const attach = gate.indexOf("authenticateFingerprint()");
    const race = gate.indexOf("Promise.race");
    expect(attach).toBeGreaterThan(-1);
    expect(race).toBeGreaterThan(attach);
  });

  it("clears the timer in a finally", () => {
    expect(gate).toMatch(/finally \{[\s\S]{0,160}clearTimeout\(timer\)/);
  });

  it("the timeout resolves false, never true", () => {
    expect(gate).toMatch(/resolve\(false\);\s*\}, 60_000\)/);
    expect(gate).not.toMatch(/resolve\(true\)/);
  });

  it("checks authenticator availability first", () => {
    const avail = gate.indexOf("isFingerprintAvailable()");
    const auth = gate.indexOf("authenticateFingerprint()");
    expect(avail).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(avail);
  });
});

describe("unmount during authorization", () => {
  const body = code(CARD);

  it("tracks whether the instance is still mounted", () => {
    expect(body).toContain("const mounted = useRef(true)");
    expect(body).toMatch(/return \(\) => \{\s*mounted\.current = false;/);
  });

  it("does NOT reveal on a result that arrives after unmount", () => {
    // The consequential one. A late approval reaching a REMOUNTED card would
    // open it without that instance ever running a ceremony.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toMatch(/if \(!mounted\.current\) return;\s*setIsRevealed\(true\)/);
  });

  it("does not flip after unmount either", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toMatch(/if \(!mounted\.current\) return;\s*setIsFlipped/);
  });

  it("guards the authorizing flag reset", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toContain("if (mounted.current) setIsAuthorizing(false)");
  });

  it("still buzzes on refusal regardless of mount state", () => {
    // The user is present and refused; they get the feedback either way.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    const refuse = flip.indexOf("if (!authorized)");
    const reveal = flip.indexOf("setIsRevealed(true)");
    expect(refuse).toBeGreaterThan(-1);
    expect(reveal).toBeGreaterThan(-1);

    // The error haptic lives in the refusal branch, which returns before the
    // mounted guard and the reveal below it.
    const refusalBranch = flip.slice(refuse, reveal);
    expect(refusalBranch).toContain('triggerHaptic("error")');
    // And it is NOT wrapped in a mounted check — the user is present and refused.
    expect(refusalBranch).not.toMatch(/if \(!?mounted\.current\)[\s\S]{0,40}triggerHaptic\("error"\)/);
  });
});

describe("credentials without a gate are refused, not silently shown", () => {
  // AUDIT FINDING. The authorization block is guarded by
  //   `!isFlipped && !isRevealed && onRevealRequest`
  // which SHORT-CIRCUITS when no gate is supplied — so a caller passing
  // cvv/fullPan with no onRevealRequest flipped straight to the back face with no
  // authorization at all.
  //
  // Nothing leaked today, because `isRevealed` stays false and both render
  // expressions mask on it. But that is masking rescuing an ungated path, not the
  // path being correct: one edit to either expression turns it into a real leak.
  // The card now refuses to flip instead.
  const body = code(CARD);

  it("detects that credentials were supplied", () => {
    expect(body).toContain("const hasCredentials =");
    expect(body).toMatch(/held\(cvv\) \|\| held\(fullPan\) \|\| held\(expiry\)/);
  });

  it("refuses the flip when credentials exist but no gate does", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toMatch(/else if \(!isFlipped && !isRevealed && hasCredentials\)/);
    // And that branch returns rather than falling through to setIsFlipped.
    const branch = flip.slice(flip.indexOf("hasCredentials)"));
    expect(branch).toMatch(/triggerHaptic\("error"\);\s*return;/);
  });

  it("uses the empty-ish helper, so cvv:'' does not count as a credential", () => {
    // A blank string is not a secret; refusing to flip for it would break a
    // legitimate caller that passes empty placeholders.
    expect(body).toContain("Boolean(held(cvv)");
  });

  it("is a dependency, so the guard cannot read a stale value", () => {
    expect(body).toContain("onRevealRequest, hasCredentials]");
  });

  it("a card with NO credentials and no gate still flips freely", () => {
    // The ordinary masked card must stay usable — refusing every ungated flip
    // would break the only caller in the app.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    // The refusal is conditional on hasCredentials, not on the gate alone.
    expect(flip).not.toMatch(/else if \(!isFlipped && !isRevealed\)\s*\{/);
  });
});

describe("a late ceremony still hits the server", () => {
  // AUDIT FINDING, and the one with a consequence beyond the UI.
  //
  // authenticateFingerprint() is not a local check: it POSTs the assertion to
  // /api/auth/passkey/authenticate, which calls recordStepUp(). So a ceremony
  // completing after the 60s bound grants a SERVER-SIDE step-up — satisfying the
  // wallet-link and account gates — seconds after the user was told the reveal
  // failed. The client cannot revoke that, but it must not treat the result as
  // its own answer, and it should say plainly that it happened.
  const gate = code(PAGE).slice(
    code(PAGE).indexOf("const requestCardStepUp"),
    code(PAGE).indexOf("const loadTxs")
  );

  it("marks the ceremony abandoned when the timeout wins", () => {
    expect(gate).toContain("abandoned = true");
    // Set inside the timeout callback, before it resolves.
    expect(gate).toMatch(/setTimeout\(\(\) => \{\s*abandoned = true;\s*resolve\(false\);/);
  });

  it("warns when a stale approval lands", () => {
    expect(gate).toMatch(/if \(abandoned && ok/);
    expect(gate).toMatch(/recorded a step-up/);
  });

  it("still resolves false for the caller regardless", () => {
    // The warning is diagnostics. The ANSWER must not change.
    expect(gate).toMatch(/\.then\(\(ok\) => \{[\s\S]{0,400}return ok;/);
    expect(gate).toMatch(/resolve\(false\);\s*\}, 60_000\)/);
  });

  it("keeps the rejection handler after the then", () => {
    // Order matters: .then().catch() covers a rejection from either.
    const thenAt = gate.indexOf(".then((ok)");
    const catchAt = gate.indexOf(".catch(() => false)");
    expect(thenAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(thenAt);
  });

  it("logs only under a non-production guard", () => {
    // Console noise in production is its own defect, and this text names an auth
    // event.
    expect(gate).toMatch(/process\.env\.NODE_ENV !== "production"/);
  });
});

describe("repeated activation while a ceremony is pending", () => {
  it("is refused, so ceremonies cannot stack", () => {
    // Without this, two Enter presses start two prompts and the LAST to resolve
    // wins — a refusal could land after an approval, or vice versa.
    const flip = code(CARD).slice(code(CARD).indexOf("const toggleFlip"), code(CARD).indexOf("<div"));
    expect(flip).toMatch(/if \(isAuthorizing\) return;/);
  });

  it("the guard sits before the state change that starts one", () => {
    const flip = code(CARD).slice(code(CARD).indexOf("const toggleFlip"), code(CARD).indexOf("<div"));
    expect(flip.indexOf("if (isAuthorizing) return;")).toBeLessThan(
      flip.indexOf("setIsAuthorizing(true)")
    );
  });

  it("isAuthorizing is a dependency, so the guard reads a fresh value", () => {
    expect(code(CARD)).toMatch(/\[isFlipped, isRevealed, isAuthorizing, onRevealRequest/);
  });
});
