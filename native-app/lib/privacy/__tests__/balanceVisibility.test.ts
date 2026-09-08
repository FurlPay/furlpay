import fs from "fs";
import path from "path";

// expo-sqlite has no in-process driver under jest-expo (see
// lib/money/__tests__/durability.test.ts), so device_prefs is stubbed with a
// map. What is under test is the store's behaviour, not SQLite's.
const mockPrefs = new Map<string, string>();

// A jest.fn so the write-failure case below can make it throw. `mock` prefix
// because jest.mock factories are hoisted above const declarations and only
// names matching /^mock/i may be referenced from one.
const mockPrefSet = jest.fn((k: string, v: string) => void mockPrefs.set(k, v));

jest.mock("@/lib/db", () => ({
  prefGet: (k: string) => mockPrefs.get(k) ?? null,
  prefSet: (k: string, v: string) => mockPrefSet(k, v),
}));

jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import {
  balancesHidden,
  setBalancesHidden,
  toggleBalancesHidden,
  __resetBalanceVisibilityForTest,
} from "../balanceVisibility";

beforeEach(() => {
  mockPrefs.clear();
  __resetBalanceVisibilityForTest();
});

describe("balance visibility", () => {
  it("starts visible", () => {
    // A user who never asked for this must not open the app to masked balances
    // and no idea why.
    expect(balancesHidden()).toBe(false);
  });

  it("toggles and persists", () => {
    toggleBalancesHidden();
    expect(balancesHidden()).toBe(true);
    expect(mockPrefs.get("privacy.balancesHidden")).toBe("1");

    toggleBalancesHidden();
    expect(balancesHidden()).toBe(false);
    expect(mockPrefs.get("privacy.balancesHidden")).toBe("0");
  });

  it("ignores a set to the value it already has", () => {
    setBalancesHidden(false);
    expect(mockPrefs.has("privacy.balancesHidden")).toBe(false);
  });

  it("keeps the in-memory value when the write fails", () => {
    mockPrefSet.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    // The user asked for the number gone NOW. Failing the toggle because the
    // preference could not be written is the worse outcome — the toggle works
    // for this session even though it will not survive a restart.
    expect(() => setBalancesHidden(true)).not.toThrow();
    expect(balancesHidden()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The property that actually protects the user: the toggle must reach EVERY
// figure on the hero. Masking only the headline leaves three breakdown stats
// on screen that sum to the number just hidden — which is worse than not
// having the feature, because the user believes they are covered.
//
// Pinned at source level rather than by rendering, matching how the repo pins
// other cross-cutting UI invariants (see lib/__tests__/dbClassification.test.ts).
// ---------------------------------------------------------------------------
describe("BalanceHero masks every figure together", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "components", "BalanceHero.tsx"),
    "utf8",
  );

  it("reads the shared store rather than local state", () => {
    expect(source).toContain("useBalancesHidden");
    // Local state here would mean hiding on Home and finding it visible on
    // Cards — the exact partial coverage this file exists to prevent.
    expect(source).not.toMatch(/useState[<(]\s*boolean[^)]*hidden/i);
  });

  it("passes the flag to every breakdown stat", () => {
    const statRow = source.match(/<View style=\{styles\.statRow\}>[\s\S]*?<\/View>/)?.[0] ?? "";
    expect(statRow).not.toBe("");
    const stats = statRow.match(/<Stat /g) ?? [];
    expect(stats.length).toBe(3);
    expect((statRow.match(/hidden=\{hidden\}/g) ?? []).length).toBe(3);
  });

  it("masks the headline and the available balance", () => {
    expect(source).toMatch(/\{hidden \? MASK : overview \? usd\(overview\.netWorth\)/);
    expect(source).toContain("money(overview ? available : undefined)");
  });

  it("uses a fixed-width mask, not one sized to the value", () => {
    // A mask sized to the figure leaks its magnitude to the person the toggle
    // exists to defeat.
    expect(source).toMatch(/const MASK = "[^"]+";/);
    expect(source).not.toMatch(/repeat\(\s*(formatted|shown|usd)/);
  });

  it("gives the screen reader the mask too", () => {
    // Announcing the real figure while the screen shows dots defeats the
    // toggle for anyone using VoiceOver with audio out loud.
    expect(source).toContain('tr("a11y.balanceHidden")');
    expect(source).toMatch(/hidden \? "hidden" :/);
  });
});
