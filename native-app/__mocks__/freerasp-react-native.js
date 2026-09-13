// ---------------------------------------------------------------------------
// Jest mock for freerasp-react-native.
//
// WHY THIS EXISTS. freeRASP builds a `NativeEventEmitter` at module load
// (src/api/listeners/raspExecutionState.ts), and `NativeEventEmitter` throws an
// invariant when its native module is absent — which it always is under
// jest-expo, because there is no native runtime. Any test whose import graph
// reaches `lib/security/tamperDetection.ts` therefore failed at import time,
// before a single assertion ran. That took down five suites that have nothing
// to do with tamper detection: db classification, device integrity, money
// authorize, staking parseUnits, and the Google Pay plugin.
//
// WHAT THIS DELIBERATELY DOES NOT DO: weaken any assertion. The real module is
// a native anti-tamper SDK that cannot run in a node test process at all, so
// there is no behaviour here to preserve — only the import to satisfy. Tests
// that care about tamper *handling* assert on `lib/security/tamperDetection.ts`'s
// own logic, which still runs against these stubs.
//
// `talsecStart` resolves rather than rejecting: a rejection would make the app's
// startup path look broken in tests, which is the opposite of the truth. A test
// that needs the threat path can call the captured listeners directly.
// ---------------------------------------------------------------------------

/** Listeners registered via setThreatListeners, exposed for tests that want them. */
let registeredListeners = {};

module.exports = {
  /** Starts the native RASP engine. No-op here; resolves like a clean start. */
  talsecStart: jest.fn(async () => undefined),

  /** Records the threat callbacks so a test can invoke one deliberately. */
  setThreatListeners: jest.fn((listeners) => {
    registeredListeners = listeners ?? {};
    return undefined;
  }),

  /** Test-only accessor. Not part of the real module's surface. */
  __getThreatListeners: () => registeredListeners,

  /** Test-only reset, so state does not leak between suites. */
  __reset: () => {
    registeredListeners = {};
  },
};
