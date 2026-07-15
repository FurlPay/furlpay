import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StatusBadge, SummaryRow } from "@/components/ui";
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

describe("SummaryRow — long values don't run off-screen (M2)", () => {
  it("truncates the value to one line and ellipsizes the middle (keeps both ends of an id)", async () => {
    const tree = await render(<SummaryRow k="Booking ID" v={"bk_" + "a".repeat(40)} />);
    const value = texts(tree.root).find((t) => typeof t.props.children === "string" && t.props.children.startsWith("bk_"));
    expect(value!.props.numberOfLines).toBe(1);
    expect(value!.props.ellipsizeMode).toBe("middle");
  });
});
