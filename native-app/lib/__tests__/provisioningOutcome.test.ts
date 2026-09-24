// ---------------------------------------------------------------------------
// The one property that matters: FurlPay must never tell a user a card was
// added to Apple Pay or Google Pay unless the platform said so.
//
// Every test here drives the real `startApplePayProvisioning` /
// `startGooglePayProvisioning` against fake native modules, and asserts on the
// returned ProvisioningResult. The fakes emit `onProvisioningResult` exactly
// where the real platforms do:
//
//   Apple  — PKAddPaymentPassViewControllerDelegate.didFinishAdding
//   Google — onActivityResult for the pushTokenize request code
//
// so "success" in a test means the same thing it means on a device.
// ---------------------------------------------------------------------------

// Fakes are built INSIDE the jest.mock factory and read back off the mocked
// module. They cannot live at top level: jest hoists `jest.mock` AND the
// `import` below above every `const`, so provisioning.ts captures the native
// module while a top-level fake is still in its temporal dead zone — which
// presents as "Google Pay is not supported on this device". This is the same
// pattern the sibling screen tests use.
jest.mock("expo-modules-core", () => {
  /** A fake native module that is also an event target, like Expo SDK 52+. */
  class FakeNative {
    listeners = new Map<string, Set<(e: Record<string, unknown>) => void>>();
    added = 0;
    removed = 0;
    /** What the platform will report, emitted where the real one emits it. */
    outcome: Record<string, unknown> | null = { added: true };

    addListener(event: string, listener: (e: Record<string, unknown>) => void) {
      this.added++;
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
      return {
        remove: () => {
          this.removed++;
          this.listeners.get(event)!.delete(listener);
        },
      };
    }

    emit(event: string, payload: Record<string, unknown>) {
      for (const l of [...(this.listeners.get(event) ?? [])]) l(payload);
    }

    /** Listeners still attached — must return to zero after every attempt. */
    get liveListenerCount() {
      return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
    }

    /** The verdict arrives AFTER the starting call resolves, as on device. */
    protected scheduleOutcome() {
      if (!this.outcome) return;
      const o = this.outcome;
      setImmediate(() => this.emit("onProvisioningResult", o));
    }
  }

  class FakeApple extends FakeNative {
    startCalls = 0;
    completeCalls = 0;
    canAddCard() {
      return true;
    }
    async startPushProvisioning() {
      this.startCalls++;
      this.scheduleOutcome();
      return true;
    }
    async completePushProvisioning() {
      this.completeCalls++;
      return true;
    }
  }

  class FakeGoogle extends FakeNative {
    pushCalls = 0;
    async getActiveWalletInfo() {
      return { walletId: "w_1", hardwareId: "hw_1" };
    }
    async pushTokenize() {
      this.pushCalls++;
      this.scheduleOutcome();
      return true;
    }
    async listTokens() {
      return [];
    }
  }

  const apple = new FakeApple();
  const google = new FakeGoogle();
  return {
    requireOptionalNativeModule: (name: string) =>
      name === "AppleWalletProvisioning" ? apple : google,
    __apple: apple,
    __google: google,
  };
});

jest.mock("@/lib/api", () => {
  const api = jest.fn();
  return { api, __api: api };
});

import { startApplePayProvisioning, startGooglePayProvisioning } from "@/lib/cards/provisioning";
import * as coreMod from "expo-modules-core";
import * as apiMod from "@/lib/api";

interface FakeHandle {
  listeners: Map<string, Set<(e: Record<string, unknown>) => void>>;
  added: number;
  removed: number;
  outcome: Record<string, unknown> | null;
  liveListenerCount: number;
  emit(event: string, payload: Record<string, unknown>): void;
}

// Read back off the mocked modules — the same handles provisioning.ts captured.
const mockApple = (coreMod as unknown as { __apple: FakeHandle & { startCalls: number; completeCalls: number } }).__apple;
const mockGoogle = (coreMod as unknown as { __google: FakeHandle & { pushCalls: number } }).__google;
const mockApi = (apiMod as unknown as { __api: jest.Mock }).__api;

/** A well-formed non-simulated Apple payload. */
const appleOk = {
  certs: ["Y2VydA=="],
  nonce: "bm9uY2U=",
  nonceSignature: "c2ln",
  cardholderName: "Ada Lovelace",
  lastFour: "4242",
};
/** A well-formed non-simulated Google payload. */
const googleOk = { opcBase64: "T1BDYnl0ZXM=", lastFour: "4242", displayName: "FurlPay Visa" };

beforeEach(() => {
  mockApi.mockReset();
  for (const f of [mockApple, mockGoogle]) {
    f.listeners.clear();
    f.added = 0;
    f.removed = 0;
  }
  mockApple.outcome = { added: true };
  mockApple.startCalls = 0;
  mockApple.completeCalls = 0;
  mockGoogle.outcome = { added: true };
  mockGoogle.pushCalls = 0;
});

// --- Apple ------------------------------------------------------------------

describe("Apple Pay", () => {
  it("reports success only when didFinishAdding delivered a pass", async () => {
    mockApi.mockResolvedValue(appleOk);
    mockApple.outcome = { added: true };
    await expect(startApplePayProvisioning("c_1")).resolves.toEqual({ success: true });
  });

  it("reports a cancellation as a cancellation, not a failure or a success", async () => {
    mockApi.mockResolvedValue(appleOk);
    mockApple.outcome = { added: false, cancelled: true };
    const res = await startApplePayProvisioning("c_1");
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/cancelled/i);
  });

  it("surfaces the platform's own error text on failure", async () => {
    mockApi.mockResolvedValue(appleOk);
    mockApple.outcome = { added: false, error: "Card not eligible" };
    const res = await startApplePayProvisioning("c_1");
    expect(res.success).toBe(false);
    expect(res.message).toBe("Card not eligible");
  });
});

// --- Google -----------------------------------------------------------------

describe("Google Pay", () => {
  it("reports success only on RESULT_OK", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: true };
    await expect(startGooglePayProvisioning("c_1")).resolves.toEqual({ success: true });
  });

  it("reports RESULT_CANCELED as a cancellation", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: false, cancelled: true };
    const res = await startGooglePayProvisioning("c_1");
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/cancelled/i);
  });

  it("reports any other result code as a failure", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: false, error: "Google Wallet returned result code 15" };
    const res = await startGooglePayProvisioning("c_1");
    expect(res.success).toBe(false);
    expect(res.message).toContain("result code 15");
  });
});

// --- the regression this whole file exists for ------------------------------

describe("premature success is unreachable", () => {
  it("Apple: a resolved start with NO verdict is never success", async () => {
    // This is exactly the old bug: startPushProvisioning resolved true because
    // the sheet opened, and that value was returned as `success`.
    mockApi.mockResolvedValue(appleOk);
    mockApple.outcome = null; // sheet opens, platform says nothing
    jest.useFakeTimers();
    const p = startApplePayProvisioning("c_1");
    // Async variant: it flushes MICROTASKS as well as timers. The plain
    // advanceTimersByTime fires the deadline before the awaits ahead of it have
    // resolved, so the promise never settles and the test hangs — which also
    // strands the in-flight lock and fails every later attempt in the file.
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(180_000);
    const res = await p;
    jest.useRealTimers();
    expect(res.success).toBe(false);
    expect(mockApple.startCalls).toBe(1);
  });

  it("Google: a resolved pushTokenize with NO verdict is never success", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = null;
    jest.useFakeTimers();
    const p = startGooglePayProvisioning("c_1");
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(180_000);
    const res = await p;
    jest.useRealTimers();
    expect(res.success).toBe(false);
    expect(mockGoogle.pushCalls).toBe(1);
  });
});

// --- simulated payloads never reach the platform ----------------------------

describe("simulated provisioning stops before the secure element", () => {
  it("Apple: never calls the native module", async () => {
    mockApi.mockResolvedValue({ ...appleOk, simulated: true });
    const res = await startApplePayProvisioning("c_1");
    expect(res).toEqual({
      success: true,
      simulated: true,
      message: "Simulated: no card was added to Apple Wallet.",
    });
    expect(mockApple.startCalls).toBe(0);
    expect(mockApple.completeCalls).toBe(0);
  });

  it("Google: never calls the native module", async () => {
    mockApi.mockResolvedValue({ ...googleOk, simulated: true });
    const res = await startGooglePayProvisioning("c_1");
    expect(res.simulated).toBe(true);
    expect(mockGoogle.pushCalls).toBe(0);
  });

  it("a real success carries NO simulated flag, so the two are distinguishable", async () => {
    // `simulated: true` alongside `success: true` is the contract the UI reads.
    // A platform-confirmed add must be distinguishable from a fixture, or the
    // flag protects nothing.
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: true };
    const res = await startGooglePayProvisioning("c_1");
    expect(res.success).toBe(true);
    expect(res.simulated).toBeUndefined();
  });
});

// --- duplicate verdicts and listener hygiene -------------------------------

describe("duplicate results and listener lifecycle", () => {
  it("a second verdict cannot change a settled result", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: false, cancelled: true };
    const res = await startGooglePayProvisioning("c_1");
    // Android can re-deliver an activity result on lifecycle restore.
    mockGoogle.emit("onProvisioningResult", { added: true });
    expect(res.success).toBe(false);
  });

  it("removes its listener after every attempt", async () => {
    mockApi.mockResolvedValue(googleOk);
    await startGooglePayProvisioning("c_1");
    expect(mockGoogle.liveListenerCount).toBe(0);
    await startGooglePayProvisioning("c_1");
    expect(mockGoogle.liveListenerCount).toBe(0);
    // One added and one removed per attempt — no accumulation.
    expect(mockGoogle.added).toBe(2);
    expect(mockGoogle.removed).toBe(2);
  });

  it("removes its listener even when the API call throws", async () => {
    mockApi.mockRejectedValue(new Error("network down"));
    const res = await startGooglePayProvisioning("c_1");
    expect(res.success).toBe(false);
    expect(mockGoogle.liveListenerCount).toBe(0);
  });

  it("refuses a concurrent attempt rather than sharing one verdict", async () => {
    // Two attempts share one emitter, so the first verdict would resolve both.
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = null;
    jest.useFakeTimers();
    const first = startGooglePayProvisioning("c_1");
    await jest.advanceTimersByTimeAsync(0);
    const second = await startGooglePayProvisioning("c_1");
    expect(second.success).toBe(false);
    expect(second.message).toMatch(/already in progress/i);
    await jest.advanceTimersByTimeAsync(180_000);
    await first;
    jest.useRealTimers();
  });

  it("releases the lock so a later attempt can run", async () => {
    mockApi.mockResolvedValue(googleOk);
    mockGoogle.outcome = { added: false, cancelled: true };
    await startGooglePayProvisioning("c_1");
    mockGoogle.outcome = { added: true };
    await expect(startGooglePayProvisioning("c_1")).resolves.toEqual({ success: true });
  });
});

// --- no credential material in results -------------------------------------

describe("results carry no credential material", () => {
  it("a failure message never echoes the payload", async () => {
    mockApi.mockResolvedValue({ ...googleOk, opcBase64: "U0VDUkVUX09QQw==" });
    mockGoogle.outcome = { added: false, error: "Google Wallet returned result code 15" };
    const res = await startGooglePayProvisioning("c_1");
    expect(JSON.stringify(res)).not.toContain("U0VDUkVUX09QQw");
  });

  it("an Apple failure message never echoes certs or nonce", async () => {
    mockApi.mockResolvedValue({ ...appleOk, nonce: "Tk9OQ0VTRUNSRVQ=" });
    mockApple.outcome = { added: false, error: "Card not eligible" };
    const res = await startApplePayProvisioning("c_1");
    expect(JSON.stringify(res)).not.toContain("Tk9OQ0VTRUNSRVQ");
  });
});
