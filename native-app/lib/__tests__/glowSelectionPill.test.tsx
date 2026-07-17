import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { AccessibilityInfo } from "react-native";

// The selected pill's premium glow is expo-linear-gradient; stub it to a plain
// host view so we can assert selection structure without native gradient.
jest.mock("expo-linear-gradient", () => {
  const React = require("react");
  return { LinearGradient: (p: { children?: React.ReactNode }) => React.createElement("LinearGradient", p, p.children) };
});

import { GlowSelectionPill } from "@/components/GlowSelectionPill";

function findByType(root: ReactTestInstance, t: string): ReactTestInstance[] {
  return root.findAll((n) => n.type === t);
}
// The composite <Pressable> is the only node carrying accessibilityState — its
// props are exactly what we passed (onPress, disabled, accessibilityState).
function pressable(root: ReactTestInstance): ReactTestInstance {
  return root.findAll((n) => n.props?.accessibilityState !== undefined)[0];
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: () => {} } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});
afterEach(() => jest.restoreAllMocks());

async function render(props: Parameters<typeof GlowSelectionPill>[0]) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<GlowSelectionPill {...props} />);
  });
  return tree;
}

describe("GlowSelectionPill", () => {
  it("renders the gradient border only when selected", async () => {
    const sel = await render({ label: "Stock", selected: true, onPress: () => {} });
    expect(findByType(sel.root, "LinearGradient").length).toBe(1);

    const unsel = await render({ label: "Stock", selected: false, onPress: () => {} });
    expect(findByType(unsel.root, "LinearGradient").length).toBe(0);
  });

  it("reports the selected accessibility state", async () => {
    const sel = await render({ label: "ETF", selected: true, onPress: () => {} });
    expect(pressable(sel.root).props.accessibilityState).toMatchObject({ selected: true });

    const unsel = await render({ label: "ETF", selected: false, onPress: () => {} });
    expect(pressable(unsel.root).props.accessibilityState).toMatchObject({ selected: false });
  });

  it("fires onPress when tapped", async () => {
    const onPress = jest.fn();
    const tree = await render({ label: "Crypto", selected: false, onPress });
    await act(async () => {
      pressable(tree.root).props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = jest.fn();
    const tree = await render({ label: "Crypto", selected: false, disabled: true, onPress });
    const p = pressable(tree.root);
    // Disabled pressable has no onPress handler wired.
    expect(p.props.onPress ?? undefined).toBeUndefined();
    expect(p.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("renders the label text", async () => {
    const tree = await render({ label: "Beach Getaways", selected: true, onPress: () => {} });
    const strings = tree.root
      .findAll(() => true)
      .map((n: ReactTestInstance) => n.props?.children)
      .filter((c: unknown) => typeof c === "string");
    expect(strings).toContain("Beach Getaways");
  });
});
