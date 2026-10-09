import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, parseTransaction, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ARC-P1-004: Arc signer on the KMS boundary + rail registration.
// The "KMS" here is a local development key standing in for the provider, so the
// signed transaction is real and its signer can be recovered.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Hardhat #1, public
const kmsAccount = privateKeyToAccount(KEY);
const h = vi.hoisted(() => ({ available: false, sent: [] as string[], chainId: 5042002, baseFee: 20_000_000_000n }));
vi.mock("@/lib/kmsAccount", () => ({ kmsAccountAvailable: () => h.available, createKmsAccount: () => (h.available ? kmsAccount : null) }));
vi.mock("viem", async (orig) => {
  const real = await orig<typeof import("viem")>();
  return { ...real, createPublicClient: () => ({
    getChainId: async () => h.chainId,
    getTransactionCount: async () => 7,
    getBlock: async () => ({ baseFeePerGas: h.baseFee }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => { h.sent.push(serializedTransaction); return "0x" + "ab".repeat(32); },
  }) };
});

import { arcSigner } from "../arcExecutionAdapter";
import { connectedRails, railAdapterFor, resetConfiguredRailsForTests } from "@/lib/controlPlane/railAdapter";

const USDC = "0x3600000000000000000000000000000000000000", TO = "0x" + "12".repeat(20);
const submit = (over = {}) => arcSigner({ ARC_SETTLEMENT_ADDRESS: kmsAccount.address })!.submitTransfer({ network: "arc_testnet", rpcUrl: "https://rpc.testnet.arc.io", token: USDC, to: TO, amountErc20: 25_000_000n, gasLimit: 100_000n, ...over } as never);

beforeEach(() => { h.available = false; h.sent.length = 0; h.chainId = 5042002; h.baseFee = 20_000_000_000n; resetConfiguredRailsForTests(); });
afterEach(() => vi.unstubAllEnvs());

describe("Arc signer (KMS only)", () => {
  it("is null without a KMS — there is no raw-key path", () => {
    expect(arcSigner({ ARC_SETTLEMENT_ADDRESS: kmsAccount.address })).toBeNull();
  });
  it("is null when the settlement address is missing", () => {
    h.available = true;
    expect(arcSigner({})).toBeNull();
  });
  it("signs an EIP-1559 USDC transfer() on the proven chain, above Arc's fee floor", async () => {
    h.available = true;
    expect(await submit()).toBe("0x" + "ab".repeat(32));
    const raw = h.sent[0] as `0x${string}`;
    const tx = parseTransaction(raw);
    // viem's parser omits zero-valued fields: no native value, no priority fee.
    expect(tx).toMatchObject({ type: "eip1559", chainId: 5042002, nonce: 7, gas: 100_000n, maxFeePerGas: 40_000_000_000n });
    expect(tx.value ?? 0n).toBe(0n);
    expect(tx.maxPriorityFeePerGas ?? 0n).toBe(0n);
    expect(tx.to?.toLowerCase()).toBe(USDC);
    expect(tx.maxFeePerGas! >= 20_000_000_000n).toBe(true);
    expect(decodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), data: tx.data! }).args).toEqual([expect.stringMatching(/^0x1212/i), 25_000_000n]);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(kmsAccount.address);
  });
  it("refuses to sign for an endpoint on another chain", async () => {
    h.available = true; h.chainId = 5042; // mainnet answering where testnet was asked
    await expect(submit()).rejects.toThrow(/reported chain 5042 but 5042002/);
    expect(h.sent).toEqual([]);
  });
  it("refuses zero-address sends and out-of-bounds gas before signing", async () => {
    h.available = true;
    await expect(submit({ to: "0x" + "0".repeat(40) })).rejects.toThrow(/zero address/);
    await expect(submit({ gasLimit: 10_000_000n })).rejects.toThrow(/gas limit/);
    expect(h.sent).toEqual([]);
  });
});

describe("Arc rail registration", () => {
  it("stays unregistered by default (flag off)", () => {
    expect(railAdapterFor("arc_usdc_transfer")).toBeNull();
    expect(connectedRails()).not.toContain("arc_usdc_transfer");
  });
  it("registers when the flag, endpoint and KMS signer are all present (testnet outside production)", () => {
    h.available = true;
    vi.stubEnv("ARC_RAIL_LIVE", "1"); vi.stubEnv("FURLPAY_KMS_PROVIDER", "turnkey"); vi.stubEnv("ARC_RPC_URL", "https://rpc.testnet.arc.io");
    vi.stubEnv("ARC_SETTLEMENT_ADDRESS", kmsAccount.address); vi.stubEnv("FURLPAY_ENV", "staging");
    expect(railAdapterFor("arc_usdc_transfer")?.railId).toBe("arc_usdc_transfer");
  });
  it("stays unregistered without a signer even with the flag on", () => {
    vi.stubEnv("ARC_RAIL_LIVE", "1"); vi.stubEnv("FURLPAY_KMS_PROVIDER", "turnkey"); vi.stubEnv("ARC_RPC_URL", "https://rpc.testnet.arc.io"); vi.stubEnv("FURLPAY_ENV", "staging");
    expect(railAdapterFor("arc_usdc_transfer")).toBeNull();
  });
});
