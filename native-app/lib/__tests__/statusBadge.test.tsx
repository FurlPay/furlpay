import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { PreviewBanner, Stepper, StatusBadge, SummaryRow } from "@/components/ui";
import { colors } from "@/lib/theme";

// StatusBadge must colour TRIP statuses, not just payment statuses. Before the
// fix, "confirmed"/"cancelled" fell through to the neutral gray default, so a
// confirmed booking didn't look confirmed. (M1)

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(node);
  });
  return tree;
}
function texts(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((n) => n.type === "Text");
}

describe("StatusBadge — trip statuses (M1)", () => {
  it("colours 'confirmed' with the positive/neon foreground, not the gray fallback", async () => {
    const tree = await render(<StatusBadge status="confirmed" />);
    const label = texts(tree.root).find((t) => t.props.children === "confirmed");
    expect(label).toBeTruthy();
    const style = ([] as unknown[]).concat(label!.props.style).find((s) => s && (s as { color?: string }).color);
    expect((style as { color: string }).color).toBe(colors.neon);
    expect((style as { color: string }).color).not.toBe(colors.textDim); // not the fallback
  });

  it("colours 'cancelled' with the accent/negative foreground", async () => {
    const tree = await render(<StatusBadge status="cancelled" />);
    const label = texts(tree.root).find((t) => t.props.children === "cancelled");
    const style = ([] as unknown[]).concat(label!.props.style).find((s) => s && (s as { color?: string }).color);
    expect((style as { color: string }).color).toBe(colors.accent);
  });

  it("still falls back to gray for an unknown status", async () => {
    const tree = await render(<StatusBadge status="totally-unknown" />);
    const label = texts(tree.root).find((t) => t.props.children === "totally-unknown");
    const style = ([] as unknown[]).concat(label!.props.style).find((s) => s && (s as { color?: string }).color);
    expect((style as { color: string }).color).toBe(colors.textDim);
  });
});

describe("PreviewBanner — honest disclosure for client-only flows", () => {
  it("states that no real money will move, as an accessibility alert", async () => {
    const tree = await render(<PreviewBanner />);
    const alert = tree.root.findAll((n) => n.props?.accessibilityRole === "alert");
    expect(alert.length).toBeGreaterThanOrEqual(1);
    const strings = tree.root
      .findAll(() => true)
      .map((n) => n.props?.children)
      .filter((c): c is string => typeof c === "string");
    const joined = strings.join(" ");
    expect(joined).toMatch(/Preview/i);
    expect(joined).toMatch(/no real money will move/i);
  });

  it("colours the disclosure with the warning tone, not a success/neon tone", async () => {
    const tree = await render(<PreviewBanner />);
    const label = texts(tree.root).find((t) => typeof t.props.children === "string");
    const style = ([] as unknown[]).concat(label!.props.style).find((s) => s && (s as { color?: string }).color);
    expect((style as { color: string }).color).toBe(colors.warning);
    expect((style as { color: string }).color).not.toBe(colors.neon);
  });
});

describe("Stepper — bounded integer control (nights/guests)", () => {
  // The composite Pressable and its host node both carry the props; take the
  // first match for a given a11y label so "minus" vs "plus" is unambiguous.
  const btn = (root: ReactTestInstance, prefix: string) =>
    root.findAll(
      (n) =>
        typeof n.props?.onPress === "function" &&
        String(n.props?.accessibilityLabel ?? "").startsWith(prefix)
    )[0];

  it("pluralizes the readout via the suffix", async () => {
    const one = await render(<Stepper value={1} onChange={() => {}} suffix={["night", "nights"]} />);
    expect(texts(one.root).some((t) => t.props.children === "1 night")).toBe(true);
    const many = await render(<Stepper value={3} onChange={() => {}} suffix={["night", "nights"]} />);
    expect(texts(many.root).some((t) => t.props.children === "3 nights")).toBe(true);
  });

  it("increments and decrements through onChange", async () => {
    const onChange = jest.fn();
    const tree = await render(<Stepper value={2} min={1} max={8} onChange={onChange} />);
    await act(async () => btn(tree.root, "Increase").props.onPress());
    await act(async () => btn(tree.root, "Decrease").props.onPress());
    expect(onChange).toHaveBeenNthCalledWith(1, 3);
    expect(onChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("never fires onChange past a bound (invoking the handler at min/max is a no-op)", async () => {
    const atMin = jest.fn();
    const lo = await render(<Stepper value={1} min={1} max={8} onChange={atMin} />);
    await act(async () => btn(lo.root, "Decrease").props.onPress());
    expect(atMin).not.toHaveBeenCalled();

    const atMax = jest.fn();
    const hi = await render(<Stepper value={8} min={1} max={8} onChange={atMax} />);
    await act(async () => btn(hi.root, "Increase").props.onPress());
    expect(atMax).not.toHaveBeenCalled();
  });
});

describe("SummaryRow — long values don't run off-screen (M2)", () => {
  it("truncates the value to one line and ellipsizes the middle (keeps both ends of an id)", async () => {
    const tree = await render(<SummaryRow k="Booking ID" v={"bk_" + "a".repeat(40)} />);
    const value = texts(tree.root).find((t) => typeof t.props.children === "string" && t.props.children.startsWith("bk_"));
    expect(value!.props.numberOfLines).toBe(1);
    expect(value!.props.ellipsizeMode).toBe("middle");
  });
});
