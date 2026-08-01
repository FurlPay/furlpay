import { readFileSync } from "fs";
import { join } from "path";
import React from "react";
import { Pressable } from "react-native";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { BalanceHero } from "@/components/BalanceHero";
import type { Overview } from "@/lib/types";

// The balance card is the first thing a user reads and the number they act on,
// so the properties pinned here are about honesty, not layout:
//   * "available" is on-chain + fiat, matching the web dashboard's definition
//   * an unloaded balance renders as unknown, never as zero
//   * no percentage change is displayed, because /api/overview returns nothing
//     historical to compute one from

const overview: Overview = {
  user: {
    id: "u_1",
    name: "Ada Lovelace",
    safeAddress: "0xabc",
    kycStatus: "verified",
    region: "NL",
    tier: "plus",
  },
  netWorth: 12_345.67,
  breakdown: { crypto: 8_000, fiat: 2_000.5, equities: 2_345.17 },
  tokenBalances: [],
  fiatBalances: [],
  recentTransactions: [],
};

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

function allText(root: ReactTestInstance): string {
  return root
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : String(c ?? "");
    })
    .join("\n");
}

describe("BalanceHero", () => {
  it("shows the total, and available as on-chain + fiat", async () => {
    const tree = await render(<BalanceHero overview={overview} onAddMoney={jest.fn()} />);
    const text = allText(tree.root);
    expect(text).toContain("$12,345.67");
    // 8,000 + 2,000.50 — deliberately NOT including the invested side, which is
    // not spendable. This mirrors `available` in the web dashboard.
    expect(text).toContain("$10,000.50");
    expect(text).toContain("Available balance");
  });

  it("breaks the total down into the three real buckets", async () => {
    const text = allText((await render(<BalanceHero overview={overview} onAddMoney={jest.fn()} />)).root);
    expect(text).toContain("On-chain");
    expect(text).toContain("Fiat");
    expect(text).toContain("Invest");
    expect(text).toContain("$2,345.17");
  });

  it("renders an unloaded balance as unknown, never as zero", async () => {
    const text = allText((await render(<BalanceHero onAddMoney={jest.fn()} />)).root);
    expect(text).toContain("—");
    expect(text).not.toContain("$0.00");
  });

  it("distinguishes loading from empty", async () => {
    const text = allText((await render(<BalanceHero loading onAddMoney={jest.fn()} />)).root);
    expect(text).toContain("· · ·");
  });

  it("says so when the figure came from the offline cache", async () => {
    const tree = await render(
      <BalanceHero overview={overview} cachedAt={Date.now() - 120_000} onAddMoney={jest.fn()} />
    );
    expect(allText(tree.root)).toMatch(/cached/);
  });

  it("shows no percentage change, because the API returns nothing to derive one from", async () => {
    // Overview has netWorth + breakdown and no historical field (lib/types.ts).
    // A "+2.4%" here would be fabricated, and on a balance card a fabricated
    // number is indistinguishable from a real one.
    const text = allText((await render(<BalanceHero overview={overview} onAddMoney={jest.fn()} />)).root);
    expect(text).not.toMatch(/%/);
  });

  it("routes the add-money button to the caller", async () => {
    const onAddMoney = jest.fn();
    const tree = await render(<BalanceHero overview={overview} onAddMoney={onAddMoney} />);
    const btn = tree.root
      .findAll((n) => n.type === Pressable)
      .find((p) => p.props.accessibilityLabel === "Add money");
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.props.onPress();
    });
    expect(onAddMoney).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation scope — a performance property, pinned at the source
// because it is invisible at runtime until someone is on mobile data.
// ---------------------------------------------------------------------------

const root = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sendCode = strip(readFileSync(join(root, "lib", "send", "useSend.ts"), "utf8"));
const swapCode = strip(readFileSync(join(root, "lib", "swap", "useSwap.ts"), "utf8"));

describe("a completed money movement refetches only what it changed", () => {
  it.each([
    ["send", sendCode],
    ["swap", swapCode],
  ])("%s does not invalidate the entire query cache", (_name, code) => {
    // `invalidateQueries()` with no key marks ~30 queries stale, including
    // market bars, travel deals and KYC status.
    expect(code).not.toMatch(/invalidateQueries\(\s*\)/);
    expect(code).not.toMatch(/useInvalidateAll/);
    expect(code).toMatch(/useInvalidateAfterMoneyMove/);
  });
});
