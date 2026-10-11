// Audit P3-5 (2026-10-05): the app signed a real, 10-minute EIP-3009
// authorization BEFORE learning whether the server would settle it. Against a
// non-live deployment the server answered `simulated` while holding a valid,
// on-chain-spendable signature. Signing now requires a live, fresh quote.

const MNEMONIC = "test test test test test test test test test test test junk"; // public Hardhat mnemonic
const mockGetItem = jest.fn(async () => MNEMONIC);
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...a: unknown[]) => mockGetItem(...(a as [])),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
}));

const mockApi = jest.fn();
jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  return { ...actual, api: (...a: unknown[]) => mockApi(...a) };
});

import { quoteSignability, sendGasless } from "../wallet";

const NOW = 1_800_000_000;
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const quote = (over: Record<string, unknown> = {}) => ({
  network: "arbitrum",
  asset: { symbol: "USDC", address: ARBITRUM_USDC, decimals: 6 },
  fee: { usd: 0, sponsored: true, detail: "" },
  maxPerTransferUsd: 1000,
  live: true,
  quotedAt: NOW,
  expiresAt: NOW + 60,
  ...over,
});

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  mockApi.mockReset();
  mockGetItem.mockClear();
});

afterEach(() => jest.restoreAllMocks());

const posted = () => mockApi.mock.calls.filter(([, o]) => (o as { method?: string })?.method === "POST");

describe("sendGasless signs only against a live, fresh quote", () => {
  it("LIVE quote → signs and submits", async () => {
    mockApi.mockImplementation(async (_p: string, o?: { method?: string }) =>
      o?.method === "POST" ? { ok: true, transaction: "0xabc" } : quote()
    );
    const r = await sendGasless(TO, "1.50");
    expect(r).toEqual({ kind: "settled", transaction: "0xabc", network: "arbitrum" });
    const body = (posted()[0][1] as { body: { signature: string } }).body;
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it.each([
    ["live: false (simulated/non-live server)", { live: false }],
    ["live missing", { live: undefined }],
    ["live is the string \"true\"", { live: "true" }],
    ["live is 1", { live: 1 }],
  ])("%s → refuses: no key read, no signature, no POST", async (_l, over) => {
    mockApi.mockResolvedValue(quote(over));
    const r = await sendGasless(TO, "1.50");
    expect(r.kind).toBe("unavailable");
    expect(mockGetItem).not.toHaveBeenCalled(); // the mnemonic was never touched
    expect(posted()).toHaveLength(0);
  });

  it.each([
    ["expired", { expiresAt: NOW - 1 }],
    ["expiring exactly now", { expiresAt: NOW }],
    ["no expiry", { expiresAt: undefined }],
    ["non-numeric expiry", { expiresAt: "soon" }],
    ["implausibly long-lived", { expiresAt: NOW + 3600 }],
  ])("%s quote → refuses before signing", async (_l, over) => {
    mockApi.mockResolvedValue(quote(over));
    const r = await sendGasless(TO, "1.50");
    expect(r.kind).toBe("unavailable");
    expect(posted()).toHaveLength(0);
  });

  it("a quote that expires DURING the biometric prompt is not signed", async () => {
    mockApi.mockResolvedValue(quote({ expiresAt: NOW + 30 }));
    // The address read is the first biometric-gated keystore read; time passes
    // while the sheet is up.
    mockGetItem.mockImplementationOnce(async () => {
      (Date.now as jest.Mock).mockReturnValue((NOW + 45) * 1000);
      return MNEMONIC;
    });
    const r = await sendGasless(TO, "1.50");
    expect(r.kind).toBe("unavailable");
    expect(posted()).toHaveLength(0);
  });
});

describe("quoteSignability", () => {
  it("accepts only live === true with a near-future expiry", () => {
    expect(quoteSignability(quote(), NOW)).toEqual({ ok: true });
    expect(quoteSignability(null, NOW).ok).toBe(false);
    expect(quoteSignability(quote({ live: false }), NOW).ok).toBe(false);
  });
});
