import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// Regression for the release-only login crash: expo-auth-session's Google
// provider THROWS during render when the platform client id is undefined
// ("Client Id property `androidClientId` must be defined …"). useGoogleSignIn
// is called unconditionally at the top of the login screen, so that throw took
// down the ENTIRE login (not just the hidden Google button) on a build with no
// client id — a dead login. The fix passes a placeholder when unconfigured.
//
// This mock faithfully reproduces expo's real behaviour (throw on a missing
// platform id), so a revert to `androidClientId: GOOGLE_ANDROID_CLIENT_ID`
// fails the "does not throw" case below.

const captured: Array<{ androidClientId?: string; webClientId?: string }> = [];
jest.mock("expo-auth-session/providers/google", () => ({
  useIdTokenAuthRequest: (config: { androidClientId?: string; webClientId?: string }) => {
    captured.push(config);
    if (!config.androidClientId) {
      throw new Error(
        "Client Id property `androidClientId` must be defined to use Google auth on this platform."
      );
    }
    return [{ url: "https://accounts.google.com" }, null, jest.fn()];
  },
}));
jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn(), openAuthSessionAsync: jest.fn() }));
jest.mock("expo-linking", () => ({ parse: jest.fn(() => ({ queryParams: {} })) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "test-uuid" }));

// The env var is unset in the test env — exactly the unconfigured release case.
import { useGoogleSignIn, googleConfigured } from "../oauth";

function Harness() {
  useGoogleSignIn();
  return null;
}

describe("useGoogleSignIn with no client id configured", () => {
  it("treats the build as not-google-configured", () => {
    expect(googleConfigured).toBe(false);
  });

  it("does NOT throw during render — the login screen must not crash", () => {
    expect(() => {
      act(() => {
        TestRenderer.create(React.createElement(Harness));
      });
    }).not.toThrow();
  });

  it("passes a DEFINED androidClientId (and webClientId) to expo, never undefined", () => {
    expect(captured.length).toBeGreaterThan(0);
    const last = captured[captured.length - 1];
    expect(last.androidClientId).toBeTruthy();
    expect(last.webClientId).toBeTruthy();
  });
});
