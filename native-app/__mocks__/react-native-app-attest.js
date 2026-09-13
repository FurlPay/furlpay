// ---------------------------------------------------------------------------
// Jest mock for react-native-app-attest.
//
// The real module calls `TurboModuleRegistry.getEnforcing('AppAttest')` at
// import time, which throws under jest-expo because there is no native binary
// registering that module. `lib/security/deviceIntegrity.ts` requires it on the
// iOS branch, so the whole suite failed to run before any assertion executed.
//
// The stubs below FAIL CLOSED, which mirrors what the production code must do:
// `isSupported()` resolves false, so a test that does not explicitly opt into
// attestation sees "attestation unavailable" rather than a silent pass. An
// attestation mock that returned a valid-looking token by default would let a
// test assert that a device was verified when nothing verified it — the exact
// false assurance this layer exists to prevent.
//
// A test that wants the success path should mock these per-case.
// ---------------------------------------------------------------------------

module.exports = {
  default: {
    /** Attestation support is a device capability; absent in a test process. */
    isSupported: jest.fn(async () => false),

    /** Refuses rather than minting a fake key id. */
    generateKey: jest.fn(async () => {
      throw new Error("App Attest is not available in the test environment.");
    }),

    /** Refuses rather than returning an attestation nothing produced. */
    attestKey: jest.fn(async () => {
      throw new Error("App Attest is not available in the test environment.");
    }),

    /** Refuses rather than returning a valid-looking assertion. */
    generateAssertion: jest.fn(async () => {
      throw new Error("App Attest is not available in the test environment.");
    }),
  },
};
