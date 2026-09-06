import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEvmSettler, liveSettlerAvailable } from "../x402Settler";
import { resolveKms, TurnkeyKmsProvider } from "../kms";

// ---------------------------------------------------------------------------
// The settler's signing gate.
//
// THE BUG THIS PINS. lib/kms.ts refuses env-key signing in production and
// flags.ts gates ONCHAIN_SETTLEMENT_LIVE on FURLPAY_KMS_PROVIDER. Both were
// correct and neither was reachable: x402Settler called
// `privateKeyToAccount(process.env.FACILITATOR_EVM_PRIVATE_KEY)` directly and
// never consulted the flag. The single path that signs in production went past
// both controls.
//
// Every test below is a different way of asking "can this deployment
// broadcast?", and the answer must be no unless the deployment is genuinely
// configured to. A settler that returns null is the safe outcome —
// x402Facilitator.settle() then answers `settler_unavailable` rather than
// falling back to the mock, which is what would credit balance off a fabricated
// hash.
// ---------------------------------------------------------------------------

// A syntactically valid secp256k1 key. Well-known hardhat account #0 — public
// by construction, and used here exactly as GO-LIVE-MONEY.md §3a uses it.
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const TOUCHED = [
  "FURLPAY_ENV",
  "NODE_ENV",
  "VERCEL_ENV",
  "ONCHAIN_SETTLEMENT_LIVE",
  "FURLPAY_MONEY_KILL_SWITCH",
  "FURLPAY_KMS_PROVIDER",
  "FACILITATOR_EVM_PRIVATE_KEY",
  "FACILITATOR_EVM_ADDRESS",
  "ARBITRUM_RPC_URL",
  "TURNKEY_ORGANIZATION_ID",
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
  "TURNKEY_GAS_SPONSOR_ADDRESS",
  "TURNKEY_SETTLEMENT_ADDRESS",
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  // Silence the deliberate operator warnings these tests provoke.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  vi.restoreAllMocks();
});

/** Everything a production deployment needs EXCEPT the thing under test. */
function productionWithKms() {
  process.env.FURLPAY_ENV = "production";
  process.env.ONCHAIN_SETTLEMENT_LIVE = "1";
  process.env.ARBITRUM_RPC_URL = "https://rpc.example.invalid";
  process.env.FURLPAY_KMS_PROVIDER = "turnkey";
  process.env.TURNKEY_ORGANIZATION_ID = "org_test";
  process.env.TURNKEY_API_PUBLIC_KEY = "pub_test";
  process.env.TURNKEY_API_PRIVATE_KEY = "priv_test";
  process.env.TURNKEY_GAS_SPONSOR_ADDRESS = ADDRESS;
  process.env.FACILITATOR_EVM_ADDRESS = ADDRESS;
}

describe("x402 settler — production refuses a raw environment key", () => {
  it("returns null when the ONLY signer is FACILITATOR_EVM_PRIVATE_KEY", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.ONCHAIN_SETTLEMENT_LIVE = "1";
    process.env.ARBITRUM_RPC_URL = "https://rpc.example.invalid";
    // The flag cannot even be ON without a KMS provider, but set the key anyway:
    // the point is that a key alone must never be enough in production.
    process.env.FACILITATOR_EVM_PRIVATE_KEY = DEV_KEY;

    expect(createEvmSettler()).toBeNull();
    expect(liveSettlerAvailable()).toBe(false);
  });

  it("refuses the env key even when everything else is correctly configured", () => {
    productionWithKms();
    // KMS configured but no address for it → falls through to... nothing.
    delete process.env.FACILITATOR_EVM_ADDRESS;
    process.env.FACILITATOR_EVM_PRIVATE_KEY = DEV_KEY;

    // A KMS is available, so the env-key branch is not even reached; and the
    // missing address is a misconfiguration, not a licence to use the raw key.
    expect(createEvmSettler()).toBeNull();
  });
});

describe("x402 settler — the capability flag gates broadcasting", () => {
  it("returns null in production when ONCHAIN_SETTLEMENT_LIVE is off", () => {
    productionWithKms();
    delete process.env.ONCHAIN_SETTLEMENT_LIVE;

    expect(createEvmSettler()).toBeNull();
  });

  it("returns null in staging when the flag is off, even with a valid key", () => {
    process.env.FURLPAY_ENV = "staging";
    process.env.FACILITATOR_EVM_PRIVATE_KEY = DEV_KEY;

    expect(createEvmSettler()).toBeNull();
  });

  it("returns null when the global money kill switch is engaged", () => {
    productionWithKms();
    process.env.FURLPAY_MONEY_KILL_SWITCH = "1";

    expect(createEvmSettler()).toBeNull();
  });

  it("builds a settler in production with a KMS and the flag on", () => {
    productionWithKms();
    expect(createEvmSettler()).toBeTypeOf("function");
  });
});

describe("x402 settler — development still works without a KMS", () => {
  it("builds from FACILITATOR_EVM_PRIVATE_KEY in development", () => {
    // The local-chain verification path in docs/GO-LIVE-MONEY.md §3a depends on
    // this: a hardhat node, hardhat account 0, no KMS. Tightening production
    // must not break the way the live path is actually exercised.
    process.env.FURLPAY_ENV = "development";
    process.env.FACILITATOR_EVM_PRIVATE_KEY = DEV_KEY;

    expect(createEvmSettler()).toBeTypeOf("function");
  });

  it("still returns null in development with no signer at all", () => {
    process.env.FURLPAY_ENV = "development";
    expect(createEvmSettler()).toBeNull();
  });

  it("returns null for a malformed private key rather than throwing", () => {
    process.env.FURLPAY_ENV = "development";
    process.env.FACILITATOR_EVM_PRIVATE_KEY = "not-a-key";

    expect(() => createEvmSettler()).not.toThrow();
    expect(createEvmSettler()).toBeNull();
  });
});

describe("KMS provider resolution", () => {
  it("resolves Turnkey to a hardware-backed provider when credentialed", () => {
    productionWithKms();
    const resolved = resolveKms();
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.provider).toBeInstanceOf(TurnkeyKmsProvider);
      // The property the whole boundary asserts: no key material in-process.
      expect(resolved.provider.isHardwareBacked).toBe(true);
    }
  });

  it('refuses "turnkey" when its credentials are absent', () => {
    process.env.FURLPAY_ENV = "production";
    process.env.FURLPAY_KMS_PROVIDER = "turnkey";

    const resolved = resolveKms();
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.refusal.reason).toBe("not_configured");
  });

  it('refuses "env" in production and names why', () => {
    process.env.FURLPAY_ENV = "production";
    process.env.FURLPAY_KMS_PROVIDER = "env";

    const resolved = resolveKms();
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.refusal.reason).toBe("unavailable_in_production");
  });

  it("refuses a named backend that is not implemented, instead of falling back", () => {
    // The dangerous alternative is silently using EnvKeySigner because the
    // operator asked for something we do not have.
    process.env.FURLPAY_ENV = "production";
    process.env.FURLPAY_KMS_PROVIDER = "aws-kms";

    const resolved = resolveKms();
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.refusal.reason).toBe("not_configured");
      expect(resolved.refusal.detail).toMatch(/not implemented/i);
    }
  });
});

describe("TurnkeyKmsProvider — purpose separation", () => {
  it("refuses to sign a settlement with the gas-sponsor key", async () => {
    productionWithKms();
    const provider = new TurnkeyKmsProvider();

    const result = await provider.sign({
      keyId: "furlpay-gas-sponsor",
      purpose: "settlement", // not permitted for this key
      digestHex: `0x${"11".repeat(32)}`,
      reason: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("purpose_mismatch");
    // Decisive: refused BEFORE any network call, so a purpose mismatch can
    // never reach Turnkey and depend on its policy to catch it.
  });

  it("refuses a key with no configured wallet address", async () => {
    productionWithKms();
    delete process.env.TURNKEY_SETTLEMENT_ADDRESS;
    const provider = new TurnkeyKmsProvider();

    const result = await provider.sign({
      keyId: "furlpay-settlement",
      purpose: "settlement",
      digestHex: `0x${"22".repeat(32)}`,
      reason: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("unknown_key");
  });
});
