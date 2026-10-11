import { describe, expect, it } from "vitest";
import fx from "./fixtures/cctp-v2-base.json";
import { chainOfDomain, decodeDepositForBurn, domainOf, matchIris, pairMints, TOPIC, type PendingTransfer } from "../cctp";
import type { RpcLog } from "../normalize";

// Decoders and matching against REAL Base mainnet receipts and Circle's Iris
// response (fixtures/cctp-v2-base.json, read 2026-10-07).

const burnLog = fx.burnReceipt.logs.find((l) => l.topics[0] === TOPIC.depositForBurn) as unknown as RpcLog;
const mintLogs = fx.mintReceipt.logs as unknown as RpcLog[];

describe("domains", () => {
  it("map both ways from the rails' verified table; unknown domains stay unknown", () => {
    expect([domainOf("ethereum"), domainOf("arbitrum"), domainOf("base"), domainOf("polygon"), domainOf("solana")]).toEqual([0, 3, 6, 7, 5]);
    expect(chainOfDomain(7)).toBe("polygon");
    expect(chainOfDomain(8)).toBeNull(); // Sui: not a chain FurlPay maps, never guessed
  });
});

describe("decodeDepositForBurn (REAL Base burn)", () => {
  it("decodes the canonical burn exactly", () => {
    const d = decodeDepositForBurn(burnLog)!;
    expect(d).toEqual({
      burn_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      depositor: "0x7e07a9148e9149e430c6412b79a675028595ff1f",
      min_finality_threshold: 1000,
      amount: "1499850000",
      mint_recipient: "0xe936b2c854cc37bb62f9c6a225d07612028f3694",
      destination_domain: 7,
      destination_chain: "polygon",
      max_fee: "194981",
    });
  });
  it("rejects other contracts, other events and truncated data", () => {
    expect(decodeDepositForBurn({ ...burnLog, address: "0x" + "1".repeat(40) })).toBeNull();
    expect(decodeDepositForBurn({ ...burnLog, topics: [TOPIC.mintAndWithdraw, ...burnLog.topics.slice(1)] })).toBeNull();
    expect(decodeDepositForBurn({ ...burnLog, data: burnLog.data.slice(0, 2 + 64 * 3) })).toBeNull();
  });
});

describe("pairMints (REAL Base mint)", () => {
  it("pairs MessageReceived with the MintAndWithdraw right before it", () => {
    const { mints, generic } = pairMints(mintLogs);
    expect(generic).toBe(0);
    expect(mints).toHaveLength(1);
    expect(mints[0].decoded).toEqual({
      nonce: "0x736fb44080807ca6e3a94ce599d892816cd57ebe1f622cd9ccef72127e010707",
      source_domain: 3,
      finality_threshold_executed: 1000,
      minted: "700810743",
      fee: "98127",
      mint_recipient: "0x0f8e28e80a32582fac87cfc3106953a59c9ef4ec",
      mint_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
  });
  it("a generic CCTP message (no paired MintAndWithdraw, or body version != 1) is never decoded as an amount", () => {
    const mr = mintLogs.find((l) => l.topics[0] === TOPIC.messageReceived)!;
    expect(pairMints([mr])).toEqual({ mints: [], generic: 1 });
    const v0 = { ...mr, data: mr.data.slice(0, 2 + 4 * 64) + "00000000" + mr.data.slice(2 + 4 * 64 + 8) };
    expect(pairMints([mintLogs.find((l) => l.topics[0] === TOPIC.mintAndWithdraw)!, v0])).toEqual({ mints: [], generic: 1 });
  });
});

describe("matchIris (REAL Iris response)", () => {
  const burn: PendingTransfer = { id: 1, source_domain: 6, destination_domain: 7, source_tx_hash: fx.burnReceipt.transactionHash, source_log_index: 1162, amount_raw: "1499850000", mint_recipient: "0xe936b2c854cc37bb62f9c6a225d07612028f3694", max_fee_raw: "194981" };
  it("matches the burn to its message by exact fields", () => {
    const m = matchIris([burn], fx.iris.messages).get(1)!;
    expect(m.eventNonce).toBe("0xa8a6654206bcdda603d3d3259f40afe22a9d9628c4180654378ae09ff68393b9");
    expect(m.decodedMessage?.decodedMessageBody?.feeExecuted).toBe("194980");
  });
  it("the tip value a provider served (1,500.898576, verified wrong) matches NOTHING — never the closest message", () => {
    expect(matchIris([{ ...burn, amount_raw: "1500898576" }], fx.iris.messages).get(1)).toBeNull();
  });
  it("a Solana recipient matches across encodings: Iris base58 vs the burn log's 32-byte hex (REAL Base->Solana burn)", () => {
    const b: PendingTransfer = { ...burn, destination_domain: 5, amount_raw: "5500000", max_fee_raw: "0", min_finality_threshold: 2000, mint_recipient: "0x0c7ee312830842548f0bbc0e9df5a441202cebdc93b238c2f80a2c1d183e1924" };
    const m = { status: "complete", eventNonce: "0x" + "5".repeat(64), decodedMessage: { sourceDomain: "6", destinationDomain: "5", minFinalityThreshold: "2000", decodedMessageBody: { amount: "5500000", maxFee: "0", mintRecipient: "qn7VNBQsfTfim9Cbggd32V4nLevsXFNUrrq9JjLev1y" } } };
    expect(matchIris([b], [m]).get(1)?.eventNonce).toBe(m.eventNonce);
    // …and a different Solana key does not match.
    const other = { ...m, decodedMessage: { ...m.decodedMessage, decodedMessageBody: { ...m.decodedMessage.decodedMessageBody, mintRecipient: "So11111111111111111111111111111111111111112" } } };
    expect(matchIris([b], [other]).get(1)).toBeNull();
  });
  it("Iris reporting no recipient (domain 27, REAL) matches on every other exact field — never on amount alone", () => {
    const b: PendingTransfer = { ...burn, destination_domain: 27, amount_raw: "134017334", max_fee_raw: "20906", min_finality_threshold: 1000, mint_recipient: "0x72bd20ff2f8281801bb05b7c29179026933256fabafeb13e94efd8ddbcfcf291" };
    const m = { status: "complete", eventNonce: "0x" + "6".repeat(64), decodedMessage: { sourceDomain: "6", destinationDomain: "27", minFinalityThreshold: "1000", decodedMessageBody: { amount: "134017334", maxFee: "20906", mintRecipient: null } } };
    expect(matchIris([b], [m]).get(1)?.eventNonce).toBe(m.eventNonce);
    expect(matchIris([b], [{ ...m, decodedMessage: { ...m.decodedMessage, minFinalityThreshold: "2000" } }]).get(1)).toBeNull();
  });
  it("two identical burns in one tx get two distinct messages, in log order", () => {
    const msg = fx.iris.messages[0];
    const second = { ...msg, eventNonce: "0x" + "9".repeat(64) };
    const r = matchIris([{ ...burn, id: 2, source_log_index: 2000 }, burn], [msg, second]);
    expect(r.get(1)?.eventNonce).toBe(msg.eventNonce);
    expect(r.get(2)?.eventNonce).toBe(second.eventNonce);
  });
});
