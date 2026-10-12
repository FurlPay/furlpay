import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

// The back of the card is gated on device-owner proof, turns itself away, and
// never prints a digit the app was not given. With no issuer vault there are
// no card details at all, so the only digits anywhere are the last four.

jest.mock("@expo/vector-icons", () => {
  const React_ = jest.requireActual("react") as typeof import("react");
  const { View } = jest.requireActual("react-native");
  const Stub = (props: Record<string, unknown>) => React_.createElement(View, props);
  return { Ionicons: Stub, MaterialCommunityIcons: Stub, Feather: Stub };
});
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));
jest.mock("@/lib/secureScreen", () => ({ useSecureScreen: jest.fn() }));
jest.mock("@/lib/design/theme", () => {
  const actual = jest.requireActual("@/lib/design/theme");
  return { ...actual, useTheme: () => ({ ...actual.useTheme?.(), reduceMotion: true }) };
});
const mockAuth = jest.fn();
jest.mock("@/lib/biometrics", () => ({
  authenticateDeviceOwner: (...a: unknown[]) => mockAuth(...a),
}));

import { CardDetailsReveal } from "@/components/cards/CardDetailsReveal";
import { REVEAL_VISIBLE_MS } from "@/lib/cards/designs";
import { useSecureScreen } from "@/lib/secureScreen";

const CARD = {
  label: "Everyday",
  last4: "4821",
  network: "Visa",
  kind: "virtual" as const,
  gradient: ["#F1F0FF", "#C7A7F8"] as const,
  themeId: "pearl",
  settlementCurrency: "USDC",
};

let tree: ReactTestRenderer;

function texts(): string[] {
  return tree.root.findAll((n) => n.type === Text).map((t) => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join("") : String(c ?? "");
  });
}
function button(title: string) {
  return tree.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === title)[0]
    ?? tree.root.findAll((n) => typeof n.props.onPress === "function" && n.findAll((t) => t.type === Text).some((t) => t.props.children === title))[0];
}
function backHidden(): boolean {
  return tree.root.findAll((n) => n.props.importantForAccessibility === "no-hide-descendants").length > 0;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAuth.mockReset();
  act(() => {
    tree = TestRenderer.create(<CardDetailsReveal card={CARD} />);
  });
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

it("blocks screenshots while it is on screen", () => {
  expect(useSecureScreen).toHaveBeenCalledWith("card-details");
});

it("starts on the front and asks for nothing until the user taps", () => {
  expect(mockAuth).not.toHaveBeenCalled();
  expect(backHidden()).toBe(true);
  expect(button("Show card back")).toBeTruthy();
});

it("keeps the back hidden when authentication fails", async () => {
  mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
  await act(async () => {
    await button("Show card back").props.onPress();
  });
  expect(backHidden()).toBe(true);
  expect(texts().join(" ")).toContain("Authentication failed");
});

it("offers no reveal at all on a device with no screen lock", async () => {
  mockAuth.mockResolvedValue({ ok: false, reason: "no_device_lock" });
  await act(async () => {
    await button("Show card back").props.onPress();
  });
  expect(backHidden()).toBe(true);
  expect(button("Show card back")).toBeUndefined();
});

it("turns the card over after authentication and shows only masks", async () => {
  mockAuth.mockResolvedValue({ ok: true });
  await act(async () => {
    await button("Show card back").props.onPress();
  });
  expect(backHidden()).toBe(false);
  const all = texts();
  expect(all).toContain("•••• •••• •••• 4821");
  expect(all).toContain("••/••");
  expect(all).toContain("•••");
  // No digit on screen other than the last four (shown on front and back).
  const digits = all.join("").replace(/\D/g, "");
  expect(digits.replace(/4821/g, "")).toBe("");
  expect(all.join(" ")).toContain("isn't connected yet");
});

it("turns the card back by itself", async () => {
  mockAuth.mockResolvedValue({ ok: true });
  await act(async () => {
    await button("Show card back").props.onPress();
  });
  expect(backHidden()).toBe(false);
  act(() => {
    jest.advanceTimersByTime(REVEAL_VISIBLE_MS + 10);
  });
  expect(backHidden()).toBe(true);
});
