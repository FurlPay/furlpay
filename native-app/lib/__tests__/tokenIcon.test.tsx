import React from "react";
import { Path } from "react-native-svg";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { TokenIcon } from "@/components/money/TokenIcon";
import { hasTokenMark } from "@/components/money/TokenGlyphs";
import { assetBySymbol } from "@/lib/swap/assets";

// Token icons must be OFFICIAL MARKS where one is published, and must degrade
// to the drawn lettermark where one is not — never to a blank tile, and never
// to a remote image (a broken logo on a money screen reads as a broken app).

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

const paths = (root: ReactTestInstance) => root.findAll((n) => n.type === Path);
const texts = (root: ReactTestInstance) => root.findAll((n) => n.type === "Text");

const asset = (symbol: string) => {
  const a = assetBySymbol(symbol);
  if (!a) throw new Error(`${symbol} missing from the catalogue`);
  return a;
};

describe("assets with a published brand mark", () => {
  it.each(["USDC", "USDT", "ETH", "DAI", "SOL"])("renders %s as a vector mark", async (symbol) => {
    expect(hasTokenMark(symbol)).toBe(true);
    const tree = await render(<TokenIcon asset={asset(symbol)} chain="arbitrum" size={40} />);
    // One filled path — the glyph — and no lettermark text beside it.
    expect(paths(tree.root).length).toBe(1);
    const rendered = texts(tree.root).map((t) => String(t.props.children ?? ""));
    expect(rendered).not.toContain(asset(symbol).glyph);
  });

  it("draws the mark in white so it reads on the brand-coloured tile", async () => {
    const tree = await render(<TokenIcon asset={asset("USDC")} chain="arbitrum" size={40} />);
    expect(paths(tree.root)[0].props.fill).toBe("#FFFFFF");
  });

  it("dims the mark for an unroutable asset instead of hiding it", async () => {
    const tree = await render(<TokenIcon asset={asset("SOL")} chain="solana" size={40} muted />);
    expect(paths(tree.root)[0].props.fill).not.toBe("#FFFFFF");
  });
});

describe("assets without a published mark", () => {
  it.each(["EURC", "XSGD", "XUSD"])("falls back to the %s lettermark", async (symbol) => {
    expect(hasTokenMark(symbol)).toBe(false);
    const tree = await render(<TokenIcon asset={asset(symbol)} chain="ethereum" size={40} />);
    expect(paths(tree.root).length).toBe(0);
    // The ticker glyph is rendered rather than an empty tile.
    expect(texts(tree.root).map((t) => String(t.props.children ?? ""))).toContain(
      asset(symbol).glyph
    );
  });

  it("renders something for a token that is not in the catalogue at all", async () => {
    const unknown = { ...asset("USDC"), symbol: "ZZZ", glyph: "Z" };
    const tree = await render(<TokenIcon asset={unknown} chain="arbitrum" size={40} />);
    expect(texts(tree.root).map((t) => String(t.props.children ?? ""))).toContain("Z");
  });
});

describe("the chain badge still identifies the network", () => {
  it("shows the chain short code over the token mark", async () => {
    const tree = await render(<TokenIcon asset={asset("USDC")} chain="arbitrum" size={40} />);
    // "USDC" exists on five chains and they are not interchangeable, so the
    // badge stays even now that the token itself has a real logo.
    expect(texts(tree.root).map((t) => String(t.props.children ?? ""))).toContain("AR");
  });
});
