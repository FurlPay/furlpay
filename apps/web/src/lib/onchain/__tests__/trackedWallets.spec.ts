import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Chain-agnostic tracked wallets (migration 0034): one registered wallet can
// have addresses on any chain, and every indexer sees them through the same
// trackedAddresses() / resolveAddress() path as linked wallets and env lists.

const tables: Record<string, unknown[] | Error> = {};
vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async (table: string) => {
    const t = tables[table];
    if (t instanceof Error) throw t;
    return t ?? [];
  }),
}));
vi.mock("@/lib/linkedWalletStore", () => ({ findLinkedWalletOwner: vi.fn(async () => null) }));
vi.mock("@/lib/kv", async (orig) => ({ ...(await orig<typeof import("@/lib/kv")>()), kvSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async () => undefined) }));

import { registeredAddresses, resetRegisteredCache, resolveAddress, trackedAddresses } from "../ingest";

const SOL = "3bickQtS7Xw6eYnXEEkZrVwcWsbJKhTdCLLmLv6pDWaq";
const EVM = "0x" + "ab".repeat(20);

beforeEach(() => {
  resetRegisteredCache();
  for (const k of Object.keys(tables)) delete tables[k];
  tables.linked_wallets = [];
  tables.onchain_tracked_wallets = [
    { id: "w1", scope: "treasury" },
    { id: "w2", scope: "watch" },
  ];
  tables.onchain_tracked_addresses = [
    { wallet_id: "w1", chain: "base", address: EVM },
    { wallet_id: "w1", chain: "ethereum", address: EVM },
    { wallet_id: "w1", chain: "solana", address: SOL },
    { wallet_id: "inactive", chain: "polygon", address: EVM },
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe("registered (chain-agnostic) wallets", () => {
  it("one wallet's EVM and Solana addresses are all tracked, each on its own chain; inactive wallets are not", async () => {
    const t = await trackedAddresses();
    expect(t.filter((x) => x.scope === "treasury").map((x) => `${(x.chains as string[]).join()}:${x.address}`)).toEqual([`base:${EVM}`, `ethereum:${EVM}`, `solana:${SOL}`]);
    expect(t.some((x) => (x.chains as string[]).includes?.("polygon"))).toBe(false);
  });
  it("resolveAddress finds the wallet on the right chain only", async () => {
    expect(await resolveAddress("solana", SOL)).toEqual({ scope: "treasury", user_id: null });
    expect(await resolveAddress("base", EVM)).toEqual({ scope: "treasury", user_id: null });
    expect(await resolveAddress("arbitrum", EVM)).toBeNull();
  });
  it("before migration 0034 (table missing) there are simply no registered wallets", async () => {
    tables.onchain_tracked_wallets = new Error('relation "onchain_tracked_wallets" does not exist');
    expect(await registeredAddresses()).toEqual([]);
  });
  it("any other store failure throws, so a delivery is retried rather than silently ignored", async () => {
    tables.onchain_tracked_wallets = new Error("connection reset");
    await expect(registeredAddresses()).rejects.toThrow(/connection reset/);
  });
});
