import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { BackHandler } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// react-test-renderer cannot drive Animated's native driver (no native module),
// which hangs the commit. Neutralise the animation shell — timing/parallel run
// their callbacks synchronously and Modal renders its children inline — so the
// drawer's REAL behaviour (identity, copy, sign-out, back/outside close) is what
// the test exercises. Animated.Value and Animated.View are preserved.
jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  const sync = () => ({ start: (cb?: () => void) => cb && cb() });
  RN.Animated.timing = sync;
  RN.Animated.parallel = () => ({ start: (cb?: () => void) => cb && cb() });
  RN.Modal = ({ children }: { children: React.ReactNode }) => children;
  return RN;
});

// ---------------------------------------------------------------------------
// Account drawer behaviour. Renders the REAL AccountDrawer + Avatar with only
// the platform/data edges stubbed. Covers: correct identity (name/email/short
// UID), verified badge, copy-UID, secure sign-out via the existing flow,
// Android-back + outside-tap close, and the security invariant that NO secret
// or raw UUID is rendered.
// ---------------------------------------------------------------------------

// Mocks defined INSIDE factories (jest hoists them above imports) and read back
// off the mocked modules below.
jest.mock("@/lib/auth", () => {
  const signOut = jest.fn(async () => {});
  return { useAuth: (sel: (s: Record<string, unknown>) => unknown) => sel({ signOut }), __signOut: signOut };
});
jest.mock("expo-router", () => {
  const push = jest.fn();
  return { useRouter: () => ({ push }), __push: push };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 12, left: 0, right: 0 }),
}));
jest.mock("expo-constants", () => ({ expoConfig: { version: "2.1.0" } }));
jest.mock("expo-clipboard", () => {
  const setStringAsync = jest.fn(async () => {});
  return { setStringAsync, __setStringAsync: setStringAsync };
});
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("@/lib/api", () => ({
  api: jest.fn(),
  API_BASE: "https://furlpay.com/api",
}));

import { AccountDrawer } from "@/components/AccountDrawer";
import { shortUid } from "@/lib/avatar";
import { api } from "@/lib/api";
import * as authMod from "@/lib/auth";
import * as routerMod from "expo-router";
import * as clipMod from "expo-clipboard";

const signOut = (authMod as unknown as { __signOut: jest.Mock }).__signOut;
const push = (routerMod as unknown as { __push: jest.Mock }).__push;
const setStringAsync = (clipMod as unknown as { __setStringAsync: jest.Mock }).__setStringAsync;

const ALICE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Ada Lovelace",
  email: "ada@furlpay.test",
  kycStatus: "verified",
};

let profile: typeof ALICE;

function texts(root: ReactTestInstance): string[] {
  const out: string[] = [];
  root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === "string") out.push(c);
    else if (Array.isArray(c) && c.every((x) => typeof x === "string" || typeof x === "number")) {
      out.push(c.join(""));
    }
  });
  return out;
}
function pressableWith(root: ReactTestInstance, label: RegExp): ReactTestInstance | undefined {
  return root.findAll(
    (n) =>
      typeof n.props?.onPress === "function" &&
      (label.test(String(n.props?.accessibilityLabel ?? "")) || texts(n).some((t) => label.test(t)))
  )[0];
}

let current: ReactTestRenderer | null = null;

async function render(onClose = jest.fn()) {
  // gcTime: 0 so no 5-minute garbage-collection timer lingers after the test
  // (that pending timer otherwise keeps jest's event loop alive → hang).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={qc}>
        <AccountDrawer open onClose={onClose} />
      </QueryClientProvider>
    );
  });
  current = tree;
  // Poll until the profile query resolves and the current profile's name renders
  // — a fixed microtask flush is racy across the suite.
  for (let i = 0; i < 40 && !texts(tree.root).includes(profile.name); i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  return { tree, onClose };
}

beforeEach(() => {
  jest.clearAllMocks();
  profile = { ...ALICE };
  (api as jest.Mock).mockImplementation(async () => profile);
});

afterEach(async () => {
  // Unmount so the query subscription is torn down inside the test (no resolve
  // after the environment is gone).
  if (current) {
    const t = current;
    current = null;
    await act(async () => {
      t.unmount();
    });
  }
});

// Budget, not assertion. The first render in this file pays the cold cost of
// the drawer's module graph; alone it passes in well under a second, but under
// a full `jest` run (114 suites competing for the machine) it crossed Jest's
// 5s default and failed the suite on every full run — including CI's. The
// same fix and reasoning as apps/web/vitest.config.ts `testTimeout`. Every
// assertion below is unchanged.
jest.setTimeout(20_000);

describe("AccountDrawer — identity", () => {
  it("shows the name, email, and a display-only FP- UID (never the raw UUID)", async () => {
    const { tree } = await render();
    const all = texts(tree.root);
    expect(all).toContain("Ada Lovelace");
    expect(all).toContain("ada@furlpay.test");
    expect(all.some((t) => /^FP-[0-9A-HJKMNP-TV-Z]{7}$/.test(t))).toBe(true);

    // The internal UUID must NOT appear anywhere in the rendered tree.
    expect(JSON.stringify(tree.toJSON())).not.toContain(ALICE.id);
  });

  it("shows a green Verified tick for a verified account", async () => {
    const { tree } = await render();
    const labels = tree.root
      .findAll(() => true)
      .map((n) => n.props?.accessibilityLabel)
      .filter(Boolean);
    expect(labels).toContain("Verified account");
    expect(labels).not.toContain("Unverified account");
  });

  it("shows a gray Unverified tick for an unverified account", async () => {
    profile = { ...ALICE, kycStatus: "unverified" };
    const { tree } = await render();
    const labels = tree.root
      .findAll(() => true)
      .map((n) => n.props?.accessibilityLabel)
      .filter(Boolean);
    expect(labels).toContain("Unverified account");
    expect(labels).not.toContain("Verified account");
  });

  it("renders the real app version from expo metadata", async () => {
    const { tree } = await render();
    expect(texts(tree.root).some((t) => t.includes("2.1.0"))).toBe(true);
  });
});

describe("AccountDrawer — actions", () => {
  it("copies the short UID (not the UUID) to the clipboard", async () => {
    const { tree } = await render();
    const chip = pressableWith(tree.root, /Copy account id/);
    expect(chip).toBeDefined();
    await act(async () => {
      chip!.props.onPress();
    });
    expect(setStringAsync).toHaveBeenCalledWith(shortUid(ALICE.id));
    expect(setStringAsync).not.toHaveBeenCalledWith(ALICE.id);
  });

  it("signs out through the existing secure flow", async () => {
    const { tree } = await render();
    const btn = pressableWith(tree.root, /^Sign out$/);
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.props.onPress();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("closes on outside (backdrop) tap", async () => {
    const { tree, onClose } = await render();
    const backdrop = pressableWith(tree.root, /Close account menu/);
    expect(backdrop).toBeDefined();
    await act(async () => {
      backdrop!.props.onPress();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Android hardware back", async () => {
    const addSpy = jest.spyOn(BackHandler, "addEventListener");
    const { onClose } = await render();
    // The drawer registered a back handler while open.
    const handler = addSpy.mock.calls.find((c) => c[0] === "hardwareBackPress")?.[1] as
      | (() => boolean)
      | undefined;
    expect(handler).toBeDefined();
    const consumed = handler!();
    expect(consumed).toBe(true); // event consumed, screen not popped
    expect(onClose).toHaveBeenCalled();
    addSpy.mockRestore();
  });
});

describe("AccountDrawer — no stale identity across accounts", () => {
  it("renders exactly the current profile (Bob), never a previous one (Alice)", async () => {
    // Simulate the post-switch state: the query returns Bob. The drawer is a
    // pure function of the profile query, so it can only show Bob.
    profile = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Bob Stone",
      email: "bob@furlpay.test",
      kycStatus: "unverified",
    };
    const { tree } = await render();
    const all = texts(tree.root);
    expect(all).toContain("Bob Stone");
    expect(all).not.toContain("Ada Lovelace");
    expect(all).not.toContain("ada@furlpay.test");
  });
});

describe("AccountDrawer — no secrets rendered", () => {
  it("renders no credential-shaped material", async () => {
    const { tree } = await render();
    const dump = JSON.stringify(tree.toJSON()).toLowerCase();
    for (const forbidden of ["mnemonic", "seed phrase", "private key", "eyj", "bearer", "jwt", "totp"]) {
      expect(dump).not.toContain(forbidden);
    }
  });
});
