import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  registerForPush,
  unregisterFromPush,
  installTokenRotation,
  __resetPushStateForTests,
} from "../push";

// ---------------------------------------------------------------------------
// FCM token-rotation matrix.
//
// The real lib/push.ts runs; only the platform edges are stubbed — the
// expo-notifications native module (there is no FCM in a jest process) and the
// session token in SecureStore. The registration logic itself — dedupe, retry,
// account-switch safety, the signed-out guard — is the code under test.
// ---------------------------------------------------------------------------

jest.mock("expo-notifications");
// jest-expo auto-mocks SecureStore, but not as controllable jest.fn()s — and
// the signed-in/signed-out distinction is the whole point of several cases here.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

type Listener = (t: { data: string }) => void;

/** Requests the app made to /push/devices, in order. */
interface Call {
  method: string;
  token: string;
}

let calls: Call[];
let listener: Listener | undefined;
let failuresLeft: number;
let failureStatus: number | undefined;
let deviceToken: string;

const notif = Notifications as jest.Mocked<typeof Notifications>;

beforeEach(() => {
  calls = [];
  listener = undefined;
  failuresLeft = 0;
  failureStatus = undefined;
  deviceToken = "fcm-token-A";
  __resetPushStateForTests();
  jest.useRealTimers();

  // Signed in by default.
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("session-jwt");

  notif.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
  notif.setNotificationChannelAsync.mockResolvedValue(null as never);
  notif.getDevicePushTokenAsync.mockImplementation(
    async () => ({ type: "android", data: deviceToken }) as never
  );
  notif.addPushTokenListener.mockImplementation(((cb: Listener) => {
    listener = cb;
    return { remove: () => (listener = undefined) };
  }) as never);

  global.fetch = (async (url: string, init: { method?: string; body?: string }) => {
    const body = JSON.parse(init.body ?? "{}");
    calls.push({ method: init.method ?? "GET", token: body.token });

    if (failuresLeft > 0) {
      failuresLeft--;
      if (failureStatus) {
        return {
          ok: false,
          status: failureStatus,
          headers: { get: () => null },
          json: async () => ({ error: "nope" }),
        };
      }
      throw new TypeError("Network request failed"); // transient
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ registered: true, devices: 1, deliveryConfigured: true }),
    };
  }) as unknown as typeof fetch;
});

const posted = () => calls.filter((c) => c.method === "POST").map((c) => c.token);
const deleted = () => calls.filter((c) => c.method === "DELETE").map((c) => c.token);

describe("registerForPush", () => {
  it("registers the device token", async () => {
    expect(await registerForPush()).toBe(true);
    expect(posted()).toEqual(["fcm-token-A"]);
  });

  it("deduplicates: re-registering an unchanged token makes no second call", async () => {
    expect(await registerForPush()).toBe(true);
    expect(await registerForPush()).toBe(true);
    expect(posted()).toEqual(["fcm-token-A"]); // once, not twice
  });

  it("does not register when signed out — an unauthenticated POST would 401", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    expect(await registerForPush()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns false (never throws) when push is unavailable on the build", async () => {
    notif.getDevicePushTokenAsync.mockRejectedValue(
      new Error("Default FirebaseApp is not initialized")
    );
    expect(await registerForPush()).toBe(false);
  });

  it("returns false when notification permission is denied", async () => {
    notif.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);
    expect(await registerForPush()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("token rotation", () => {
  it("registers a rotated token with the server", async () => {
    await registerForPush();
    installTokenRotation();

    listener!({ data: "fcm-token-B" });
    await new Promise((r) => setImmediate(r));

    expect(posted()).toEqual(["fcm-token-A", "fcm-token-B"]);
  });

  it("ignores a duplicate rotation callback for the token already registered", async () => {
    await registerForPush();
    installTokenRotation();

    listener!({ data: "fcm-token-A" }); // same token fired again
    listener!({ data: "fcm-token-A" });
    await new Promise((r) => setImmediate(r));

    expect(posted()).toEqual(["fcm-token-A"]); // no churn
  });

  it("retries a transient failure with backoff and eventually registers", async () => {
    await registerForPush();
    installTokenRotation();

    failuresLeft = 2; // two network errors, then success
    listener!({ data: "fcm-token-B" });
    await new Promise((r) => setTimeout(r, 3_500)); // 1s + 2s backoff

    expect(posted()).toEqual(["fcm-token-A", "fcm-token-B", "fcm-token-B", "fcm-token-B"]);
  }, 10_000);

  it("does not retry a 4xx — a rejected token or dead session is a verdict, not a blip", async () => {
    await registerForPush();
    installTokenRotation();

    failuresLeft = 3;
    failureStatus = 401;
    listener!({ data: "fcm-token-B" });
    await new Promise((r) => setTimeout(r, 1_500));

    // One attempt for B, then it stops.
    expect(posted().filter((t) => t === "fcm-token-B")).toHaveLength(1);
  });

  it("drops the rotation listener on teardown (sign-out)", async () => {
    await registerForPush();
    const stop = installTokenRotation();
    stop();
    expect(listener).toBeUndefined();
  });
});

describe("account switching (Alice → sign out → Bob)", () => {
  it("re-registers the device to the new account and never to the old one", async () => {
    // Alice signs in and registers.
    await registerForPush();
    expect(posted()).toEqual(["fcm-token-A"]);

    // Alice signs out: the device is deregistered server-side.
    await unregisterFromPush();
    expect(deleted()).toEqual(["fcm-token-A"]);

    // Bob signs in on the same device. Same FCM device token, new session — the
    // POST is authorized by Bob's session, so the server files it under Bob.
    await registerForPush();
    expect(posted()).toEqual(["fcm-token-A", "fcm-token-A"]);
  });

  it("a rotation arriving after sign-out is NOT registered to the signed-out user", async () => {
    await registerForPush();
    installTokenRotation();

    await unregisterFromPush();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null); // signed out

    listener!({ data: "fcm-token-B" });
    await new Promise((r) => setImmediate(r));

    expect(posted()).not.toContain("fcm-token-B");
  });
});

describe("unregisterFromPush", () => {
  it("deregisters even with no in-memory record — the post-restart sign-out case", async () => {
    // Fresh process (app was killed and relaunched): nothing was registered in
    // THIS process, but the device is still registered server-side. The old
    // implementation returned early here and left the device receiving pushes.
    __resetPushStateForTests();

    await unregisterFromPush();

    expect(deleted()).toEqual(["fcm-token-A"]);
  });

  it("stays silent when the build has no push support", async () => {
    __resetPushStateForTests();
    notif.getDevicePushTokenAsync.mockRejectedValue(new Error("no firebase"));

    await expect(unregisterFromPush()).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
