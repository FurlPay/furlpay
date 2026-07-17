// ---------------------------------------------------------------------------
// Native login UX behaviours that are pure client logic:
//   - a double-tap on Google cannot launch two auth flows (buttons disable
//     while any action is in flight, and cancel recovers the UI);
//   - the OTP step shows a resend countdown that ticks down and only enables
//     "Resend code" at zero.
//
// Rendered with react-test-renderer (no @testing-library dependency added). The
// auth store + oauth hook are stubbed so the component's own state machine is
// what is exercised. Mocks are created INSIDE the jest.mock factories (jest
// hoists them above imports) and read back off the mocked modules.
// ---------------------------------------------------------------------------

import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/lib/auth", () => {
  const startOtp = jest.fn(async () => ({ devCode: undefined }));
  const state: Record<string, unknown> = {
    startOtp,
    verifyOtp: jest.fn(async () => {}),
    signInWithPasskey: jest.fn(),
    enrollPasskey: jest.fn(),
    signInWithToken: jest.fn(async () => {}),
    signInAsGuest: jest.fn(),
  };
  return { useAuth: (sel: (s: Record<string, unknown>) => unknown) => sel(state), __state: state };
});

jest.mock("@/lib/oauth", () => {
  const signIn = jest.fn();
  return {
    __signIn: signIn,
    googleConfigured: true,
    appleConfigured: false,
    signInWithApple: jest.fn(),
    useGoogleSignIn: () => ({ signIn, ready: true }),
  };
});

jest.mock("@/lib/passkey", () => ({
  isPasskeySupported: () => false,
  passkeyErrorMessage: (e: unknown) => String(e),
}));

import Login from "@/app/(auth)/login";
import * as authMod from "@/lib/auth";
import * as oauthMod from "@/lib/oauth";

const signIn = (oauthMod as unknown as { __signIn: jest.Mock }).__signIn;
const startOtp = (authMod as unknown as { __state: { startOtp: jest.Mock } }).__state.startOtp;

function byTitle(root: ReactTestInstance, title: string) {
  return root.findAll((n) => n.props?.title === title, { deep: true });
}
function byStringChild(root: ReactTestInstance, re: RegExp) {
  return root.findAll((n) => typeof n.props?.children === "string" && re.test(n.props.children));
}
/** Nearest ancestor (or self) carrying an onPress handler — the real tappable. */
function pressableFor(node: ReactTestInstance): ReactTestInstance {
  let n: ReactTestInstance | null = node;
  while (n && typeof n.props?.onPress !== "function") n = n.parent;
  if (!n) throw new Error("no pressable ancestor");
  return n;
}

beforeEach(() => {
  jest.clearAllMocks();
  startOtp.mockResolvedValue({ devCode: undefined });
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("Google button — double-tap protection", () => {
  it("launches at most one auth flow and recovers on cancel", async () => {
    let release!: (v: string | null) => void;
    signIn.mockReturnValue(new Promise<string | null>((r) => (release = r)));

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Login />);
    });
    const googleBtn = () => byTitle(tree.root, "Continue with Google")[0];
    expect(googleBtn().props.disabled).toBeFalsy();

    await act(async () => {
      googleBtn().props.onPress();
    });
    // The real double-tap protection: while the flow is in flight the button is
    // disabled, so a second physical tap cannot reach the handler. One launch.
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(googleBtn().props.disabled).toBe(true);

    // User cancelled (signIn resolves null) — UI recovers, no error, tappable.
    await act(async () => {
      release(null);
    });
    expect(googleBtn().props.disabled).toBeFalsy();
  });
});

describe("Email OTP — resend countdown", () => {
  it("counts down from 30 and only enables resend at zero", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Login />);
    });

    await act(async () => {
      // The tappable is the Pressable wrapping this Text label.
      pressableFor(byStringChild(tree.root, /Sign in with email instead/)[0]).props.onPress();
    });
    await act(async () => {
      tree.root.findAll((n) => n.props?.label === "Email")[0].props.onChangeText("ash@example.com");
    });
    await act(async () => {
      await byTitle(tree.root, "Send code")[0].props.onPress();
    });
    expect(startOtp).toHaveBeenCalledWith("ash@example.com", "email");

    const resend = () => byStringChild(tree.root, /Resend code/)[0];
    expect(resend().props.children).toMatch(/Resend code in \d+s/);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(resend().props.children).toBe("Resend code");
  });
});
