// ---------------------------------------------------------------------------
// Native auth store — the client half of session security. Verifies the exact
// SecureStore + cache lifecycle the task requires:
//   - a successful sign-in stores the session (SecureStore, via setToken) and
//     wipes any previous account's cache (account-switch isolation);
//   - logout revokes server-side, drops the token, and clears every local cache;
//   - forgetSession (post account-deletion) tears down locally WITHOUT server
//     calls that would 401 on a now-deleted account.
//
// The platform edges (SecureStore-backed setToken, SQLite clearAllCaches, the
// react-query cache, push deregistration) are stubbed; the store's orchestration
// is the code under test.
// ---------------------------------------------------------------------------

jest.mock("../api", () => ({
  api: jest.fn(async () => ({})),
  getToken: jest.fn(async () => null),
  setToken: jest.fn(async () => {}),
  setUnauthorizedHandler: jest.fn(),
}));
jest.mock("../db", () => ({ clearAllCaches: jest.fn() }));
jest.mock("../push", () => ({ unregisterFromPush: jest.fn(async () => {}) }));
jest.mock("../queries", () => ({ queryClient: { clear: jest.fn() } }));
jest.mock("../passkey", () => ({
  authenticateWithPasskey: jest.fn(async () => "passkey-token"),
  registerPasskey: jest.fn(async () => "enroll-token"),
}));
jest.mock("../biometrics", () => ({
  authenticateDeviceOwner: jest.fn(async () => ({ ok: true })),
}));

import { useAuth } from "../auth";
import { api, setToken } from "../api";
import { clearAllCaches } from "../db";
import { unregisterFromPush } from "../push";
import { queryClient } from "../queries";
import { authenticateDeviceOwner } from "../biometrics";

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: "loading", email: null });
});

describe("signInWithToken (Google/Apple federated result)", () => {
  it("stores the session and enters the app", async () => {
    await useAuth.getState().signInWithToken("google-session-jwt", "ash@example.com");
    expect(setToken).toHaveBeenCalledWith("google-session-jwt");
    expect(useAuth.getState().status).toBe("signedIn");
    expect(useAuth.getState().email).toBe("ash@example.com");
  });

  it("wipes the previous account's cache on sign-in (account-switch isolation)", async () => {
    // Alice is signed in with cached data; Bob signs in on the same device.
    await useAuth.getState().signInWithToken("bob-jwt", "bob@example.com");
    // clearSessionState runs on the sign-in edge, before Bob is marked signedIn,
    // so Bob can never observe Alice's SQLite or react-query cache.
    expect(clearAllCaches).toHaveBeenCalled();
    expect(queryClient.clear).toHaveBeenCalled();
  });
});

describe("app lock", () => {
  it("keeps a stored session locked when the device has no screen lock", async () => {
    (authenticateDeviceOwner as jest.Mock).mockResolvedValueOnce({ ok: false, reason: "no_device_lock" });
    useAuth.setState({ status: "locked" });

    await expect(useAuth.getState().unlock()).resolves.toBe("no_device_lock");
    expect(useAuth.getState().status).toBe("locked");
  });

  it("only opens the session after device-owner authentication", async () => {
    (authenticateDeviceOwner as jest.Mock).mockResolvedValueOnce({ ok: true });
    useAuth.setState({ status: "locked" });

    await expect(useAuth.getState().unlock()).resolves.toBe("unlocked");
    expect(useAuth.getState().status).toBe("signedIn");
  });
});

describe("signOut", () => {
  it("revokes server-side, drops the token, and clears every local cache", async () => {
    useAuth.setState({ status: "signedIn", email: "ash@example.com" });
    await useAuth.getState().signOut();

    expect(unregisterFromPush).toHaveBeenCalled(); // stop pushes to this device
    expect(api).toHaveBeenCalledWith("/auth/logout", { method: "POST" }); // server revoke
    expect(setToken).toHaveBeenCalledWith(null); // SecureStore cleared
    expect(clearAllCaches).toHaveBeenCalled();
    expect(queryClient.clear).toHaveBeenCalled();
    expect(useAuth.getState().status).toBe("signedOut");
  });

  it("completes local sign-out even if the server revoke call fails", async () => {
    (api as jest.Mock).mockRejectedValueOnce(new Error("network"));
    useAuth.setState({ status: "signedIn" });
    await useAuth.getState().signOut();
    expect(setToken).toHaveBeenCalledWith(null);
    expect(useAuth.getState().status).toBe("signedOut");
  });
});

describe("forgetSession (post account-deletion)", () => {
  it("tears down locally WITHOUT server calls that would 401 on a deleted account", async () => {
    useAuth.setState({ status: "signedIn", email: "ash@example.com" });
    await useAuth.getState().forgetSession();

    // No /auth/logout, no push DELETE — the account is already gone server-side.
    expect(api).not.toHaveBeenCalled();
    expect(unregisterFromPush).not.toHaveBeenCalled();
    // But local state IS fully cleared.
    expect(setToken).toHaveBeenCalledWith(null);
    expect(clearAllCaches).toHaveBeenCalled();
    expect(queryClient.clear).toHaveBeenCalled();
    expect(useAuth.getState().status).toBe("signedOut");
  });
});
