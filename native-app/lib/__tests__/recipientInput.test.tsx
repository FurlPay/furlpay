import React from "react";
import { Pressable } from "react-native";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { grouped, RecipientInput } from "@/components/send/RecipientInput";
import type { RecentRecipient } from "@/lib/send/lookalike";

// The recipient card is where an address actually gets into a payment, so the
// behaviours below are the ones a user's money depends on:
//   * hold-to-paste reaches the caller
//   * the gesture has a tap equivalent
//   * a valid address is displayed IN FULL, grouped for character-by-character
//     comparison — never truncated, which is what address poisoning survives
//   * the long-press overlay steps aside once there is text to select

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

/** Every string rendered anywhere in the tree, flattened. */
function allText(root: ReactTestInstance): string {
  return root
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : String(c ?? "");
    })
    .join("\n");
}

const isPressable = (n: ReactTestInstance): boolean => n.type === Pressable;

function longPressables(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(isPressable).filter((p) => typeof p.props.onLongPress === "function");
}

const base = {
  chain: "arbitrum" as const,
  onChangeText: jest.fn(),
  onPaste: jest.fn(),
  onScan: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

describe("RecipientInput — hold to paste", () => {
  it("tells the user the gesture exists while the field is empty", async () => {
    const tree = await render(<RecipientInput {...base} value="" />);
    expect(allText(tree.root)).toContain("Hold this card to paste");
  });

  it("calls onPaste when the card is held", async () => {
    const onPaste = jest.fn();
    const tree = await render(<RecipientInput {...base} value="" onPaste={onPaste} />);
    await act(async () => {
      longPressables(tree.root)[0].props.onLongPress();
    });
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("also exposes paste as a plain button, for anyone who cannot long-press", async () => {
    const onPaste = jest.fn();
    const tree = await render(<RecipientInput {...base} value="" onPaste={onPaste} />);
    const pasteBtn = tree.root
      .findAll(isPressable)
      .find((p) => p.props.accessibilityLabel === "Paste address from clipboard");
    expect(pasteBtn).toBeTruthy();
    await act(async () => {
      pasteBtn!.props.onPress();
    });
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("mounts a full-field press target only while empty, so the OS menu wins later", async () => {
    const empty = await render(<RecipientInput {...base} value="" />);
    const filled = await render(<RecipientInput {...base} value={ADDRESS} valid />);
    // Empty: the card plus the overlay. Filled: the card alone.
    expect(longPressables(empty.root).length).toBe(2);
    expect(longPressables(filled.root).length).toBe(1);
  });

  it("does not paste when the field is not editable", async () => {
    const onPaste = jest.fn();
    const tree = await render(
      <RecipientInput {...base} value="" editable={false} onPaste={onPaste} />
    );
    await act(async () => {
      longPressables(tree.root)[0].props.onLongPress();
    });
    expect(onPaste).not.toHaveBeenCalled();
  });
});

describe("RecipientInput — verification", () => {
  it("groups the hex body into even blocks, with 0x held out", async () => {
    expect(grouped(ADDRESS)).toBe("0x 5290 8400 0985 2788 6E0F 7030 0698 57D2 E416 9EE7");
    // Non-hex (Solana base58) has no prefix to hold out.
    expect(grouped("5Q544fKrFoe6tsEbD7S8Em")).toBe("5Q54 4fKr Foe6 tsEb D7S8 Em");
    // Every character survives the grouping — this is a verification aid, not
    // a formatter, and dropping one would defeat the point.
    expect(grouped(ADDRESS).replace(/ /g, "")).toBe(ADDRESS);
  });

  it("renders the whole address, grouped, when it is valid", async () => {
    const tree = await render(<RecipientInput {...base} value={ADDRESS} valid />);
    const text = allText(tree.root);
    expect(text).toContain(grouped(ADDRESS));
    expect(text).toContain("Compare every character");
    expect(text).toContain("Valid Arbitrum One address");
  });

  it("never renders the address in truncated form", async () => {
    const tree = await render(<RecipientInput {...base} value={ADDRESS} valid />);
    // "0x529084…9EE7" is the shape address poisoning is mined to match.
    expect(allText(tree.root)).not.toContain("…");
  });

  it("shows the error instead of the verification block when the address is wrong", async () => {
    const tree = await render(
      <RecipientInput {...base} value="0xnope" error="That isn't an EVM address." />
    );
    const text = allText(tree.root);
    expect(text).toContain("That isn't an EVM address.");
    expect(text).not.toContain("Compare every character");
  });

  it("surfaces a failed paste without wiping what the user has", async () => {
    const tree = await render(
      <RecipientInput {...base} value="" pasteNotice="Your clipboard is empty." />
    );
    expect(allText(tree.root)).toContain("Your clipboard is empty.");
  });
});

describe("RecipientInput — recents", () => {
  const recent: RecentRecipient = {
    address: ADDRESS,
    chain: "arbitrum",
    token: "USDC",
    lastUsedAt: Date.now(),
    count: 2,
  };

  it("fills the field with the EXACT stored address, not the displayed short form", async () => {
    const onPickRecent = jest.fn();
    const tree = await render(
      <RecipientInput {...base} value="" recents={[recent]} onPickRecent={onPickRecent} />
    );
    const chip = tree.root
      .findAll(isPressable)
      .find((p) => String(p.props.accessibilityLabel ?? "").startsWith("Send to "));
    expect(chip).toBeTruthy();
    await act(async () => {
      chip!.props.onPress();
    });
    expect(onPickRecent).toHaveBeenCalledWith(recent);
    expect(onPickRecent.mock.calls[0][0].address).toBe(ADDRESS);
  });

  it("renders no recents section when there is no history", async () => {
    const tree = await render(<RecipientInput {...base} value="" recents={[]} />);
    expect(allText(tree.root)).not.toContain("RECENT");
  });
});
