import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "../evm/rlp";
import { serializeSigned, signingHash, transactionHash, type Eip1559Transaction } from "../evm/transaction";

// ---------------------------------------------------------------------------
// Arc USDC send (ARC-P1-005 / P4-001). The rules that cost money on Arc:
// one 18dp balance pays amount AND fee, the fee is already USDC, and anything
// priced under the 20 gwei floor is silently dropped. RPC is mocked; the
// signature is real (a public test key) so the payload is checked end to end.
// ---------------------------------------------------------------------------

jest.mock("../api", () => ({ api: jest.fn(), ApiError: class ApiError extends Error {}, NetworkError: class NetworkError extends Error {} }));
jest.mock("../wallet", () => ({ signTransaction: jest.fn() }));
jest.mock("../evm/rpc", () => ({
  ...jest.requireActual("../evm/rpc"),
  getTransactionCount: jest.fn(),
  getFeeCaps: jest.fn(),
  getBalance: jest.fn(),
  estimateGas: jest.fn(),
  sendRawTransaction: jest.fn(),
  waitForReceipt: jest.fn(),
}));

const rpc = require("../evm/rpc") as Record<string, jest.Mock>;
const wallet = require("../wallet") as { signTransaction: jest.Mock };
const arc = require("../arc/send") as typeof import("../arc/send");

// Hardhat account #1 — public test key, never funded on Arc.
const PRIV = Uint8Array.from(Buffer.from("59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "hex"));
const FROM = "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(PRIV, false).slice(1)).slice(-20)).slice(2);
const TO = "0x1212121212121212121212121212121212121212";
const USDC18 = 1_000_000_000_000_000_000n;

function realSign(tx: Eip1559Transaction) {
  const sig = secp256k1.sign(signingHash(tx), PRIV);
  const s = { yParity: sig.recovery, r: sig.r, s: sig.s };
  return { raw: serializeSigned(tx, s), hash: transactionHash(tx, s), from: FROM };
}

beforeEach(() => {
  jest.clearAllMocks();
  rpc.getBalance.mockResolvedValue(30n * USDC18);
  rpc.getTransactionCount.mockResolvedValue(4n);
  rpc.getFeeCaps.mockResolvedValue({ maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
  rpc.estimateGas.mockResolvedValue(56_000n);
  wallet.signTransaction.mockImplementation(async (tx: Eip1559Transaction) => realSign(tx));
  rpc.sendRawTransaction.mockImplementation(async (_c: string, raw: string) => "0x" + bytesToHex(keccak_256(Uint8Array.from(Buffer.from(raw.slice(2), "hex")))).slice(2));
  rpc.waitForReceipt.mockResolvedValue({ status: "0x1", blockNumber: "0x10", transactionHash: "0x", gasUsed: "0xb000" });
});

describe("amounts and display", () => {
  it("parses USDC to 6dp exactly and refuses rounding", () => {
    expect(arc.parseUsdc("12.5")).toBe(12_500_000n);
    expect(arc.parseUsdc("0.000001")).toBe(1n);
    expect(() => arc.parseUsdc("0.0000001")).toThrow(/6 decimals/);
    expect(() => arc.parseUsdc("1e3")).toThrow();
    expect(() => arc.parseUsdc("0")).toThrow(/more than zero/);
    expect(() => arc.parseUsdc("-1")).toThrow();
  });
  it("shows an 18dp fee as USDC, never through an ETH price", () => {
    // 56,000 gas × 40 gwei = 0.00224 USDC.
    expect(arc.formatFee(56_000n * 40_000_000_000n)).toBe("0.00224 USDC");
    expect(arc.formatFee(1n)).toBe("< 0.00001 USDC");
    expect(arc.formatUsdc18(30n * USDC18 + 1n)).toBe("30");
  });
  it("encodes transfer(address,uint256) with the published selector", () => {
    expect(arc.encodeUsdcTransfer(TO, 25_000_000n)).toBe("0xa9059cbb" + TO.slice(2).padStart(64, "0") + (25_000_000).toString(16).padStart(64, "0"));
  });
});

describe("prepareArcSend", () => {
  it("builds a value-0 transfer() to 0x3600 on the right chain, priced at or above the fee floor", async () => {
    const p = await arc.prepareArcSend({ chain: "arc-testnet", from: FROM, to: TO, amount: "25" });
    expect(p.tx).toMatchObject({ chainId: 5042002, nonce: 4n, to: arc.ARC_USDC, value: 0n, gasLimit: 56_000n, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 0n });
    expect(p.maxFee).toBe(56_000n * 40_000_000_000n);
    expect((await arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "1" })).tx.chainId).toBe(5042);
  });
  it("keeps a node's higher fee cap", async () => {
    rpc.getFeeCaps.mockResolvedValue({ maxFeePerGas: 90_000_000_000n, maxPriorityFeePerGas: 1n });
    expect((await arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "1" })).tx.maxFeePerGas).toBe(90_000_000_000n);
  });
  it("checks amount + fee against the ONE native balance, before any signature", async () => {
    rpc.getBalance.mockResolvedValue(25n * USDC18); // exactly the amount, nothing left for gas
    await expect(arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "25" })).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
  it("refuses the zero address, the USDC contract, itself, and a bad address", async () => {
    for (const to of ["0x" + "0".repeat(40), arc.ARC_USDC, FROM, "0x1234"]) {
      await expect(arc.prepareArcSend({ chain: "arc", from: FROM, to, amount: "1" })).rejects.toMatchObject({ code: "invalid_recipient" });
    }
  });
  it("refuses a gas quote that is not a plain transfer", async () => {
    rpc.estimateGas.mockResolvedValue(5_000_000n);
    await expect(arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "1" })).rejects.toMatchObject({ code: "gas_out_of_bounds" });
  });
});

describe("sendArcUsdc", () => {
  it("signs, broadcasts the exact signed bytes and returns the explorer link", async () => {
    const p = await arc.prepareArcSend({ chain: "arc-testnet", from: FROM, to: TO, amount: "25" });
    const r = await arc.sendArcUsdc(p);
    const raw = rpc.sendRawTransaction.mock.calls[0][1] as string;
    expect(raw.startsWith("0x02")).toBe(true); // EIP-1559 envelope
    expect(r.hash).toBe(realSign(p.tx).hash);
    expect(r.explorerUrl).toBe(`https://explorer.testnet.arc.io/tx/${r.hash}`);
    expect(rpc.waitForReceipt).toHaveBeenCalledWith("arc-testnet", r.hash, expect.objectContaining({ replacementWatch: { from: FROM, nonce: 4n } }));
  });
  it("stops if the device key is not the prepared sender", async () => {
    const p = await arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "1" });
    wallet.signTransaction.mockResolvedValue({ raw: "0x02", hash: "0x01", from: TO });
    await expect(arc.sendArcUsdc(p)).rejects.toMatchObject({ code: "signer_mismatch" });
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("reports a reverted transfer as charged-but-not-sent", async () => {
    rpc.waitForReceipt.mockResolvedValue({ status: "0x0", blockNumber: "0x10", transactionHash: "0x", gasUsed: "0x1" });
    const p = await arc.prepareArcSend({ chain: "arc", from: FROM, to: TO, amount: "1" });
    await expect(arc.sendArcUsdc(p)).rejects.toMatchObject({ code: "reverted" });
  });
});
