import { encodeFunctionData, getAddress, pad, type Address, type Hex } from "viem";
import { Chain } from "@furlpay/types";
import {
  FAST_FINALITY_THRESHOLD,
  STANDARD_FINALITY_THRESHOLD,
  bpsToAtomic,
  fetchCctpFee,
} from "./cctpFees";

// ---------------------------------------------------------------------------
// CCTP V2 execution — real burn-and-mint calldata + Iris attestation polling.
//
// Non-custodial, same convention as Earn/Morpho (lib/services/morpho.ts):
// FurlPay never holds user keys, so this module returns UNSIGNED calldata the
// user's wallet/Safe signs, plus the attestation poll the client (or a worker)
// runs between burn and mint:
//
//   1. BURN  (source chain): approve USDC -> TokenMessengerV2.depositForBurn
//   2. ATTEST: poll Iris GET /v2/messages?transactionHash=... until the
//      attestation status is "complete"
//   3. MINT  (destination): MessageTransmitterV2.receiveMessage(message, att)
//
// Contract addresses verified against developers.circle.com (CCTP V2, 2026):
// mainnet TokenMessengerV2/MessageTransmitterV2 are the same address on every
// EVM chain; testnets share their own pair. Fast Transfer = maxFee >= the
// fast-fee minimum AND minFinalityThreshold <= 1000; Standard = threshold 2000
// with zero fee. quoteCctp (lib/services/cctp.ts) prices these modes.
// ---------------------------------------------------------------------------

export const CCTP_DOMAINS: Partial<Record<Chain, number>> = {
  ethereum: 0,
  arbitrum: 3,
  base: 6,
  polygon: 7,
};

const MAINNET_TOKEN_MESSENGER: Address = getAddress("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
const MAINNET_MESSAGE_TRANSMITTER: Address = getAddress("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
const TESTNET_TOKEN_MESSENGER: Address = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
const TESTNET_MESSAGE_TRANSMITTER: Address = getAddress("0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");

const IRIS_API = process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com";

// Native (Circle-issued) USDC per supported mainnet chain.
export const CCTP_USDC: Partial<Record<Chain, Address>> = {
  ethereum: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  arbitrum: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  base: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  polygon: getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
};

const USDC_DECIMALS = 6;

/** Headroom authorised above the corridor's published fee, as a percentage.
 *  20% absorbs a rate move between quote and submission without materially
 *  over-authorising: on a $1,000 fast transfer at 1.4bps this is 2.8 cents of
 *  expected fee and a 3.4 cent ceiling. */
const FEE_CEILING_BUFFER_PCT = 20n;
const testnet = () => process.env.CCTP_TESTNET === "1";
export const tokenMessenger = (): Address => (testnet() ? TESTNET_TOKEN_MESSENGER : MAINNET_TOKEN_MESSENGER);
export const messageTransmitter = (): Address => (testnet() ? TESTNET_MESSAGE_TRANSMITTER : MAINNET_MESSAGE_TRANSMITTER);

const ERC20_APPROVE_ABI = [{
  type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

// CCTP V2 depositForBurn — adds destinationCaller/maxFee/minFinalityThreshold
// over V1. destinationCaller = bytes32(0) lets anyone submit the mint.
const TOKEN_MESSENGER_V2_ABI = [{
  type: "function", name: "depositForBurn", stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
  ],
  outputs: [],
}] as const;

const MESSAGE_TRANSMITTER_V2_ABI = [{
  type: "function", name: "receiveMessage", stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  outputs: [{ type: "bool" }],
}] as const;

export interface CctpBurnBundle {
  mode: "fast" | "standard";
  sourceChain: Chain;
  destinationChain: Chain;
  destinationDomain: number;
  amountAtomic: string;
  /** What Circle is expected to take, at the corridor's published rate. */
  feeAtomic: string;
  /** The rate that produced it, in basis points, as published by Circle. */
  feeBps: number;
  /** The ceiling authorised on-chain: expected fee plus buffer. Circle takes
   *  the real fee, never more than this. */
  maxFeeAtomic: string;
  /** Sign + send in order: [0] approve USDC, [1] depositForBurn. */
  transactions: { to: Address; data: Hex; value: "0"; description: string }[];
  /** After the burn tx lands, poll this until status=complete, then mint. */
  attestationPath: string;
}

/**
 * Build the unsigned burn leg: approve + TokenMessengerV2.depositForBurn.
 * Fast mode sets threshold 1000 and a `maxFee` ceiling taken from Circle's
 * PUBLISHED fee for this corridor; standard is free with threshold 2000 (hard
 * finality, ~13-19 min).
 *
 * THE BUG THIS FIXES. `maxFee` used to be a hardcoded `amountAtomic / 10_000n`
 * — 1 basis point — to match what quoteCctp was guessing. `maxFee` is the
 * ceiling the payer authorises, and Circle grants Fast Transfer only when that
 * ceiling covers the real fee. On arbitrum->base the real fee is 1.4bps, so a
 * 1bp ceiling did not fail loudly: the burn fell through to the standard path
 * and took ~13-19 minutes after the user had been quoted 20 seconds.
 *
 * The ceiling is now the corridor's real fee plus an explicit buffer, because a
 * fee that ticks up between quote and submission must not strand the transfer.
 * The buffer is authorised headroom, not an expected charge — Circle takes the
 * actual fee, never more than the ceiling — and callers surface `feeAtomic`
 * (expected) separately from `maxFeeAtomic` (worst case).
 *
 * Async and able to throw: with no readable fee there is no honest ceiling to
 * set, so it refuses rather than reinstating a guess.
 */
export async function buildBurnBundle(params: {
  sourceChain: Chain;
  destinationChain: Chain;
  amount: number; // human USDC
  recipient: Address; // mint recipient on the destination chain
  fast?: boolean;
  signal?: AbortSignal;
}): Promise<CctpBurnBundle> {
  const { sourceChain, destinationChain, amount, recipient, fast = true, signal } = params;
  const srcDomain = CCTP_DOMAINS[sourceChain];
  const dstDomain = CCTP_DOMAINS[destinationChain];
  const burnToken = CCTP_USDC[sourceChain];
  if (srcDomain === undefined || dstDomain === undefined || !burnToken) {
    throw new Error(`CCTP V2 not supported for ${sourceChain} -> ${destinationChain}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid amount");

  const amountAtomic = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));

  // Circle's published fee for THIS corridor — never an assumed rate. Standard
  // transfers must pass maxFee 0, so only the fast path needs a ceiling.
  const fee = await fetchCctpFee(srcDomain, dstDomain, { signal });
  const feeAtomic = fast ? bpsToAtomic(amountAtomic, fee.fastBps) : 0n;
  // Authorised headroom over the expected fee, so a rate that moves between
  // quoting and submitting does not strand the transfer on the slow path.
  // Circle charges the real fee and never more than this ceiling.
  const maxFee = fast ? feeAtomic + (feeAtomic * FEE_CEILING_BUFFER_PCT) / 100n : 0n;
  const minFinalityThreshold = fast ? FAST_FINALITY_THRESHOLD : STANDARD_FINALITY_THRESHOLD;
  const messenger = tokenMessenger();

  const approve = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [messenger, amountAtomic],
  });
  const burn = encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurn",
    args: [
      amountAtomic,
      dstDomain,
      pad(recipient, { size: 32 }), // bytes32 left-padded address
      burnToken,
      pad("0x0", { size: 32 }), // destinationCaller: anyone may mint
      maxFee,
      minFinalityThreshold,
    ],
  });

  return {
    mode: fast ? "fast" : "standard",
    sourceChain,
    destinationChain,
    destinationDomain: dstDomain,
    amountAtomic: amountAtomic.toString(),
    feeAtomic: feeAtomic.toString(),
    feeBps: fast ? fee.fastBps : fee.standardBps,
    maxFeeAtomic: maxFee.toString(),
    transactions: [
      { to: burnToken, data: approve, value: "0", description: `Approve ${amount} USDC to TokenMessengerV2` },
      { to: messenger, data: burn, value: "0", description: `Burn ${amount} USDC for ${destinationChain} (domain ${dstDomain})` },
    ],
    attestationPath: `/api/intents/cctp/attestation?sourceDomain=${srcDomain}&txHash=`,
  };
}

export interface CctpAttestation {
  status: "pending" | "complete";
  message?: Hex;
  attestation?: Hex;
  eventNonce?: string;
}

/** Poll Iris for the burn's message + attestation (GET /v2/messages). */
export async function fetchAttestation(sourceDomain: number, txHash: string): Promise<CctpAttestation> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("invalid txHash");
  const url = `${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 404) return { status: "pending" }; // not yet observed
  if (!res.ok) throw new Error(`iris ${res.status}`);
  const body = (await res.json()) as { messages?: { status?: string; message?: string; attestation?: string; eventNonce?: string }[] };
  const msg = body.messages?.[0];
  if (!msg || msg.status !== "complete" || !msg.message || !msg.attestation) return { status: "pending" };
  return {
    status: "complete",
    message: msg.message as Hex,
    attestation: msg.attestation as Hex,
    eventNonce: msg.eventNonce,
  };
}

/** Build the unsigned mint leg: MessageTransmitterV2.receiveMessage on the
 *  destination chain, submittable by any account (destinationCaller = 0). */
export function buildMintTransaction(message: Hex, attestation: Hex): { to: Address; data: Hex; value: "0"; description: string } {
  return {
    to: messageTransmitter(),
    data: encodeFunctionData({
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: "receiveMessage",
      args: [message, attestation],
    }),
    value: "0",
    description: "Mint USDC on the destination chain (receiveMessage)",
  };
}
