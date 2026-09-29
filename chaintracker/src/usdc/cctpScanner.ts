// CCTP V2 burn/mint scanner and correlator.
//
// THE PROBLEM THIS SOLVES. A CCTP transfer is two on-chain events: USDC is
// burned on the source chain and an equal amount is minted on the destination.
// Counted naively, a $10M cross-chain transfer appears as $10M leaving one chain
// and $10M arriving on another — $20M of "movement" for $10M of economic
// activity. On a day with heavy bridging that single mistake can inflate the
// headline figure by a large fraction, and it inflates it in a way that looks
// entirely plausible.
//
// So the burn and the mint are joined into one row, and the daily aggregate
// counts that row once.
//
// WHY JOINING IS HARD IN V2, and it was easy in V1. V1's `DepositForBurn` event
// carried a uint64 nonce, so both legs shared a key that was visible on chain.
// V2 removed it — the nonce is assigned by Circle's attestation service, and the
// source chain's `MessageSent` payload has thirty-two zero bytes where the nonce
// goes. This was verified by decoding a live MessageSent on Base, not assumed.
//
// So there are two correlation paths, and which one was used is recorded on the
// row:
//
//   iris_nonce   Authoritative. Iris is asked for the nonce assigned to the
//                burn's transaction; the destination's `MessageReceived` event
//                indexes that same nonce. A genuine join.
//   heuristic    Fallback when Iris is unreachable or the burn tx contained
//                several burns. Matches on
//                (sourceDomain, destDomain, amount, mintRecipient) within a
//                window. Strong, but two identical transfers between the same
//                addresses in the same window would collide, so it is labelled
//                as inferred everywhere it surfaces.
//
// A burn that cannot be joined stays `status: 'burned'` forever rather than being
// paired with a guess. An unjoined burn under-reports; a wrongly joined one
// reports a transfer that never happened.

import { cursors } from "../db/index.js";
import { evm } from "../providers/index.js";
import { makeLogger } from "../util/logger.js";
import { cctpDb } from "../db/usdc.js";
import { chainRowFor, isUsableTimestamp } from "./scanner.js";
import { cctpMatchKey, nonceForBurn } from "./iris.js";
import {
  CCTP_V2_MSG,
  cctpContractsFor,
  cctpDomainName,
  getChainByCctpDomain,
  getEvmScanAssets,
  getUsdcAsset,
  isNativeUsdc,
  TOPIC_CCTP_V2_DEPOSIT_FOR_BURN,
  TOPIC_CCTP_V2_MESSAGE_RECEIVED,
  TOPIC_CCTP_V2_MINT_AND_WITHDRAW,
} from "./registry.js";
import type { CctpTransfer, UsdcAsset } from "./types.js";

const log = makeLogger("usdc:cctp-scan");

export const CCTP_SCANNER = "usdc-cctp";

/** Same reasoning as the transfer scanner: bounded catch-up, chunked reads. */
const MAX_BLOCK_SPAN = 2_000;
const LOGS_CHUNK_BLOCKS = 400;
const COLD_START_BLOCKS = 500;

/**
 * How long a heuristic match may reach back.
 *
 * CCTP fast transfers settle in seconds and standard transfers in minutes to
 * tens of minutes depending on source-chain finality. Two hours comfortably
 * covers the slow path; reaching much further would start matching unrelated
 * transfers that merely happen to share an amount and a recipient.
 */
const HEURISTIC_WINDOW_MS = 2 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* ABI decoding                                                        */
/* ------------------------------------------------------------------ */

/**
 * The nth 32-byte word of a log's data field, as a hex string with no 0x.
 *
 * Hand-rolled because this module needs exactly two decoders and the repository
 * has no ABI library — adding one for sixty lines of fixed-layout parsing would
 * be a dependency to audit for no benefit. The layouts it decodes are pinned in
 * registry.ts against live logs.
 */
function word(data: string, index: number): string | null {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  const start = index * 64;
  if (body.length < start + 64) return null;
  return body.slice(start, start + 64);
}

function wordBig(data: string, index: number): bigint | null {
  const w = word(data, index);
  if (w === null) return null;
  try {
    return BigInt("0x" + w);
  } catch {
    return null;
  }
}

function wordNum(data: string, index: number): number | null {
  const b = wordBig(data, index);
  if (b === null) return null;
  const n = Number(b);
  return Number.isSafeInteger(n) ? n : null;
}

/** A bytes32 topic/word holding a right-aligned 20-byte address. */
function bytes32ToAddress(w: string): string {
  const clean = w.startsWith("0x") ? w.slice(2) : w;
  return "0x" + clean.slice(-40).toLowerCase();
}

/** USDC base units to a whole-token amount, exact to the cent at any size. */
function toUsdc(raw: bigint): number {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return Number(whole) + Number(frac) / 1e6;
}

export interface DecodedBurn {
  burnToken: string;
  depositor: string;
  amount: number;
  mintRecipient: string;
  destinationDomain: number;
  maxFee: number;
  minFinalityThreshold: number;
}

/**
 * Decode a `DepositForBurn` log.
 *
 * Layout (verified field by field against a live Base log, see registry.ts):
 *   topics[1] burnToken, topics[2] depositor, topics[3] minFinalityThreshold
 *   data w0 amount, w1 mintRecipient, w2 destinationDomain,
 *        w3 destinationTokenMessenger, w4 destinationCaller, w5 maxFee,
 *        w6 hookData offset
 *
 * Returns null on anything unexpected rather than a partially-filled object,
 * because a half-decoded burn would enter the table as a real transfer.
 */
export function decodeDepositForBurn(logEntry: {
  topics: string[];
  data: string;
}): DecodedBurn | null {
  if (logEntry.topics[0]?.toLowerCase() !== TOPIC_CCTP_V2_DEPOSIT_FOR_BURN) return null;
  if (logEntry.topics.length !== 4) return null;

  const amount = wordBig(logEntry.data, 0);
  const mintRecipient = word(logEntry.data, 1);
  const destinationDomain = wordNum(logEntry.data, 2);
  const maxFee = wordBig(logEntry.data, 5);
  const threshold = wordNum(logEntry.topics[3]!, 0);

  if (amount === null || amount <= 0n) return null;
  if (mintRecipient === null || destinationDomain === null) return null;

  return {
    burnToken: bytes32ToAddress(logEntry.topics[1]!),
    depositor: bytes32ToAddress(logEntry.topics[2]!),
    amount: toUsdc(amount),
    mintRecipient: "0x" + mintRecipient,
    destinationDomain,
    maxFee: maxFee === null ? 0 : toUsdc(maxFee),
    minFinalityThreshold: threshold ?? 0,
  };
}

export interface DecodedMessageReceived {
  nonce: string;
  sourceDomain: number;
  sender: string;
  finalityThresholdExecuted: number;
  /** Decoded from messageBody when it is a TokenMessenger burn message. */
  amount: number | null;
  mintRecipient: string | null;
  /** The source-chain token as an EVM address, or null when the source is not EVM. */
  burnToken: string | null;
  /** The raw 32 bytes, which is all there is for a non-EVM source. */
  burnTokenRaw: string | null;
  /** 1 = CCTP V2 BurnMessage. Anything else is not a token transfer. */
  bodyVersion: number | null;
}

/**
 * Decode a `MessageReceived` log, including the burn message inside its body.
 *
 * Layout:
 *   topics[1] caller, topics[2] nonce (THE correlation key),
 *   topics[3] finalityThresholdExecuted
 *   data w0 sourceDomain, w1 sender, w2 messageBody offset,
 *        then messageBody length, then the body
 *
 * The body is a TokenMessenger BurnMessage:
 *   version(4) burnToken(32) mintRecipient(32) amount(32) messageSender(32)
 *   maxFee(32) feeExecuted(32) expirationBlock(32) hookData(...)
 *
 * The body fields are optional in the return type on purpose: `MessageReceived`
 * is emitted for every CCTP message, and a non-token message has no amount. A
 * missing amount means "this was not a token transfer", not "the amount was
 * zero".
 */
export function decodeMessageReceived(logEntry: {
  topics: string[];
  data: string;
}): DecodedMessageReceived | null {
  if (logEntry.topics[0]?.toLowerCase() !== TOPIC_CCTP_V2_MESSAGE_RECEIVED) return null;
  if (logEntry.topics.length !== 4) return null;

  const sourceDomain = wordNum(logEntry.data, 0);
  const nonce = logEntry.topics[2];
  const threshold = wordNum(logEntry.topics[3]!, 0);
  if (sourceDomain === null || !nonce) return null;

  const out: DecodedMessageReceived = {
    nonce: nonce.toLowerCase(),
    sourceDomain,
    sender: word(logEntry.data, 1) ? "0x" + word(logEntry.data, 1)! : "",
    finalityThresholdExecuted: threshold ?? 0,
    amount: null,
    mintRecipient: null,
    burnToken: null,
    burnTokenRaw: null,
    bodyVersion: null,
  };

  // messageBody: w2 holds the byte offset of its length word, relative to the
  // start of the data section. The body itself begins one word after that.
  const bodyOffsetBytes = wordNum(logEntry.data, 2);
  if (bodyOffsetBytes === null) return out;

  const body = logEntry.data.startsWith("0x") ? logEntry.data.slice(2) : logEntry.data;
  const lenWordStart = bodyOffsetBytes * 2;
  if (body.length < lenWordStart + 64) return out;

  const bodyStart = lenWordStart + 64;

  // THE BODY VERSION GATE, and why it is not optional.
  //
  // MessageTransmitterV2 carries arbitrary cross-chain messages, not only token
  // transfers — anyone may use it for their own messaging. Measured on Base: 3 of
  // 25 MessageReceived events in a 500-block window were third-party generic
  // messages from HyperEVM, carrying a body version of 0 and a completely
  // different layout. Decoding one of those as a BurnMessage produced an "amount"
  // of $42,949,672,960 — obviously wrong once seen, and it would have been added
  // silently to a daily total.
  //
  // A CCTP V2 BurnMessage is version 1. Anything else is not a token transfer and
  // has no amount to read.
  const versionHex = body.slice(bodyStart, bodyStart + 8);
  if (versionHex.length < 8) return out;
  out.bodyVersion = Number.parseInt(versionHex, 16);
  if (out.bodyVersion !== 1) return out;

  // BurnMessage: a 4-byte version prefix, then 32-byte fields. Everything below
  // is offset by those 4 bytes (8 hex chars), which is the detail most easily
  // got wrong — an ordinary word index would read the amount as garbage.
  const V = 8;
  const field = (n: number): string | null => {
    const start = bodyStart + V + n * 64;
    return body.length >= start + 64 ? body.slice(start, start + 64) : null;
  };

  const burnToken = field(0);
  const mintRecipient = field(1);
  const amountHex = field(2);
  if (!burnToken || !mintRecipient || !amountHex) return out;

  try {
    const amt = BigInt("0x" + amountHex);
    if (amt > 0n) out.amount = toUsdc(amt);
  } catch {
    // Leave amount null: an undecodable body must not become a zero-value row.
  }

  // burnToken is the token on the SOURCE chain, so it is only an EVM address when
  // the source is an EVM chain. A Solana mint or a Stellar asset fills all 32
  // bytes, and taking the last 20 of those as an address yields a meaningless
  // value that would fail every validation — measured against real Solana- and
  // Stellar-originated mints arriving on Base.
  out.burnTokenRaw = "0x" + burnToken;
  out.burnToken = isEvmBytes32(burnToken) ? bytes32ToAddress(burnToken) : null;
  out.mintRecipient = "0x" + mintRecipient;
  return out;
}

/**
 * Does this bytes32 hold a right-aligned 20-byte EVM address?
 *
 * True when the leading 12 bytes are zero. A non-EVM chain's token or account
 * identifier uses the full width, so this distinguishes "an address that was
 * padded" from "32 bytes that mean something else".
 */
export function isEvmBytes32(w: string): boolean {
  const clean = w.startsWith("0x") ? w.slice(2) : w;
  if (clean.length !== 64) return false;
  if (!/^0{24}/.test(clean)) return false;
  return !/^0{64}$/.test(clean);
}

export interface DecodedMintAndWithdraw {
  /** The destination-chain token actually minted. Validatable, unlike burnToken. */
  mintToken: string;
  mintRecipient: string;
  amount: number;
  /** Fee CCTP actually took, in USDC. Exact, not the burn side's maxFee. */
  feeCollected: number;
}

/**
 * Decode TokenMessengerV2's `MintAndWithdraw`.
 *
 *   MintAndWithdraw(
 *     address indexed mintRecipient,  topics[1]
 *     uint256 amount,                 data word 0
 *     address indexed mintToken,      topics[2]
 *     uint256 feeCollected            data word 1
 *   )
 *
 * WHY THE MINT PATH RESTS ON THIS RATHER THAN THE MESSAGE BODY. Three reasons, all
 * measured against live Base logs:
 *
 *   1. `mintToken` is the token on THIS chain, so it can be checked against this
 *      chain's verified native USDC. The body's `burnToken` belongs to the source
 *      chain and cannot be validated at all when that chain is not EVM — a third
 *      of the mints arriving on Base came from Solana, Stellar and Arc.
 *   2. TokenMessengerV2 emits it only for real token mints, so its presence is
 *      itself the filter that excludes third-party generic CCTP messages. In the
 *      measured window, 22 of 25 MessageReceived events had one; the 3 that did
 *      not were exactly the non-token messages.
 *   3. `feeCollected` is what the transfer actually paid, where the burn side only
 *      knows the maximum it was willing to pay.
 */
export function decodeMintAndWithdraw(logEntry: {
  topics: string[];
  data: string;
}): DecodedMintAndWithdraw | null {
  if (logEntry.topics[0]?.toLowerCase() !== TOPIC_CCTP_V2_MINT_AND_WITHDRAW) return null;
  if (logEntry.topics.length !== 3) return null;

  const amount = wordBig(logEntry.data, 0);
  const fee = wordBig(logEntry.data, 1);
  if (amount === null || amount <= 0n) return null;

  return {
    mintToken: bytes32ToAddress(logEntry.topics[2]!),
    mintRecipient: bytes32ToAddress(logEntry.topics[1]!),
    amount: toUsdc(amount),
    feeCollected: fee === null ? 0 : toUsdc(fee),
  };
}

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

export interface CctpScanResult {
  chainSlug: string;
  fromBlock: number;
  toBlock: number;
  burnsFound: number;
  burnsNew: number;
  mintsFound: number;
  completed: number;
  error: string | null;
}

/**
 * Scan one chain for both legs of CCTP activity.
 *
 * Both legs are read in the same pass because a chain is simultaneously a source
 * and a destination, and the alternative — two scanners with two cursors over the
 * same blocks — doubles the RPC cost for no gain.
 */
export async function scanCctpChain(asset: UsdcAsset): Promise<CctpScanResult> {
  const result: CctpScanResult = {
    chainSlug: asset.chainSlug,
    fromBlock: 0,
    toBlock: 0,
    burnsFound: 0,
    burnsNew: 0,
    mintsFound: 0,
    completed: 0,
    error: null,
  };

  const contracts = cctpContractsFor(asset.chainSlug);
  const sourceDomain = asset.cctpDomain;
  if (!contracts || sourceDomain === null) {
    // Celo and ZKsync Era reach here: real native USDC, no CCTP deployment.
    // Not an error, and not something to retry.
    return result;
  }

  const chain = chainRowFor(asset);

  let head: number;
  try {
    head = await evm.blockNumber(chain);
  } catch (err) {
    result.error = (err as Error).message.slice(0, 160);
    return result;
  }

  const cursor = cursors.get(asset.chainSlug, CCTP_SCANNER);
  const from = cursor.lastBlock ? cursor.lastBlock + 1 : Math.max(1, head - COLD_START_BLOCKS);
  if (from > head) {
    result.fromBlock = from;
    result.toBlock = head;
    return result;
  }
  const start = Math.max(from, head - MAX_BLOCK_SPAN);
  result.fromBlock = start;
  result.toBlock = head;

  /* --- Burns on this chain ---------------------------------------- */

  try {
    const burnLogs = await getLogs(chain, start, head, contracts.tokenMessenger, [
      TOPIC_CCTP_V2_DEPOSIT_FOR_BURN,
    ]);
    const blockTimes = await burnBlockTimes(chain, burnLogs);

    for (const l of burnLogs) {
      const decoded = decodeDepositForBurn(l);
      if (!decoded) continue;

      // The burn token must be this chain's verified native USDC. CCTP can in
      // principle carry other tokens, and counting one as USDC would put a
      // non-USDC amount into a USDC total.
      if (!isNativeUsdc(asset.chainSlug, decoded.burnToken)) continue;

      result.burnsFound += 1;
      const ts = blockTimes.get(l.blockNumber);
      // Never date a burn "now", and never accept a time that cannot be real — the
      // same rule the transfer scanner uses, for the same reason. See
      // isUsableTimestamp.
      if (ts === undefined || !isUsableTimestamp(ts)) continue;

      const matchKey = cctpMatchKey(
        sourceDomain,
        decoded.destinationDomain,
        decoded.amount,
        decoded.mintRecipient
      );

      // Stored immediately with a pending key so the burn is never lost while
      // waiting on Iris, then upgraded to the real nonce by the attestation
      // poller. The pending key is unmistakably synthetic — it embeds the source
      // tx hash — so it can never be mistaken for a nonce that exists on chain.
      const burn: CctpTransfer = {
        sourceChain: asset.chainSlug,
        sourceTx: l.transactionHash,
        sourceDomain,
        destChain: getChainByCctpDomain(decoded.destinationDomain),
        destTx: null,
        destDomain: decoded.destinationDomain,
        nonce: pendingNonceKey(l.transactionHash, l.logIndex),
        sender: decoded.depositor,
        recipient: decoded.mintRecipient,
        amount: decoded.amount,
        feeUsdc: null,
        finalityExecuted: null,
        burnTs: ts,
        mintTs: null,
        status: "burned",
        correlation: "none",
        cctpVersion: 2,
        alerted: false,
      };

      if (cctpDb.insertBurn(burn, matchKey)) result.burnsNew += 1;
    }
  } catch (err) {
    result.error = `burns: ${(err as Error).message.slice(0, 120)}`;
  }

  /* --- Mints arriving on this chain -------------------------------- */
  //
  // Two log reads, joined by transaction hash:
  //
  //   MessageReceived  (MessageTransmitterV2)  gives the NONCE and sourceDomain
  //   MintAndWithdraw  (TokenMessengerV2)      gives the AMOUNT, FEE and the
  //                                           destination token we can validate
  //
  // Neither is sufficient alone. MessageReceived is emitted for every CCTP
  // message including third-party generic ones, so taking its body as a token
  // transfer produces fabricated amounts. MintAndWithdraw is emitted only for real
  // token mints but carries no nonce, so it cannot be correlated back to a burn.
  // Requiring both is what makes a mint row simultaneously identified and verified.

  try {
    const [recvLogs, mintLogs] = await Promise.all([
      getLogs(chain, start, head, contracts.messageTransmitter, [
        TOPIC_CCTP_V2_MESSAGE_RECEIVED,
      ]),
      getLogs(chain, start, head, contracts.tokenMessenger, [
        TOPIC_CCTP_V2_MINT_AND_WITHDRAW,
      ]),
    ]);

    // Grouped by transaction, and within a transaction kept in log order. A
    // relayer can batch several mints into one transaction, and pairing them by
    // position is what keeps each nonce with its own amount — pairing on the
    // transaction alone would attribute the first amount to every nonce in it.
    const mintsByTx = new Map<string, CctpLog[]>();
    for (const m of mintLogs) {
      const list = mintsByTx.get(m.transactionHash) ?? [];
      list.push(m);
      mintsByTx.set(m.transactionHash, list);
    }
    for (const list of mintsByTx.values()) list.sort((a, b) => a.logIndex - b.logIndex);

    const recvByTx = new Map<string, CctpLog[]>();
    for (const r of recvLogs) {
      const list = recvByTx.get(r.transactionHash) ?? [];
      list.push(r);
      recvByTx.set(r.transactionHash, list);
    }
    for (const list of recvByTx.values()) list.sort((a, b) => a.logIndex - b.logIndex);

    const blockTimes = await burnBlockTimes(chain, recvLogs);

    for (const [txHash, receives] of recvByTx) {
      const mints = mintsByTx.get(txHash) ?? [];
      if (mints.length === 0) {
        // A CCTP message with no token mint in the same transaction. Real, but not
        // a USDC transfer — this is the branch that excludes the third-party
        // generic messaging measured on Base.
        continue;
      }

      for (let i = 0; i < receives.length; i++) {
        const recv = receives[i]!;
        const decoded = decodeMessageReceived(recv);
        if (!decoded) continue;

        // Only a CCTP V2 BurnMessage body describes a token transfer.
        if (decoded.bodyVersion !== 1) continue;

        // Pair by position; fall back to the sole mint when counts differ, which
        // happens when one transaction mixes a token transfer with a non-token
        // message.
        const mintLog = mints[i] ?? (mints.length === 1 ? mints[0]! : undefined);
        if (!mintLog) continue;

        const mint = decodeMintAndWithdraw(mintLog);
        if (!mint) continue;

        // THE VALIDATION THAT MATTERS. mintToken is the token minted on THIS
        // chain, so it is checkable against this chain's verified native USDC.
        // Anything else is a CCTP transfer of some other asset and does not belong
        // in a USDC total.
        if (!isNativeUsdc(asset.chainSlug, mint.mintToken)) continue;

        result.mintsFound += 1;
        const ts = blockTimes.get(recv.blockNumber) ?? null;

        const completed = cctpDb.completeMint({
          nonce: decoded.nonce,
          sourceDomain: decoded.sourceDomain,
          destChain: asset.chainSlug,
          destTx: txHash,
          mintTs: ts ?? Date.now(),
          finalityExecuted: decoded.finalityThresholdExecuted,
          // The amount comes from MintAndWithdraw, and the burn side recorded the
          // amount it burned. CCTP takes its fee out of the transfer, so the mint
          // is SMALLER than the burn by exactly feeCollected — adding it back is
          // what makes the two sides' match keys agree. Getting this wrong would
          // silently disable the fallback join on every fast transfer.
          matchKey: cctpMatchKey(
            decoded.sourceDomain,
            sourceDomain,
            mint.amount + mint.feeCollected,
            mint.mintRecipient
          ),
          heuristicWindowMs: HEURISTIC_WINDOW_MS,
          feeUsdc: mint.feeCollected,
        });
        if (completed) result.completed += 1;
      }
    }
  } catch (err) {
    result.error =
      (result.error ? result.error + "; " : "") + `mints: ${(err as Error).message.slice(0, 120)}`;
  }

  if (!result.error) cursors.set(asset.chainSlug, CCTP_SCANNER, head);

  if (result.burnsNew || result.completed || result.error) {
    log.info("cctp scan", {
      chain: asset.chainSlug,
      blocks: `${start}-${head}`,
      burnsNew: result.burnsNew,
      completed: result.completed,
      err: result.error ?? undefined,
    });
  }
  return result;
}

/**
 * A placeholder correlation key for a burn whose nonce is not yet known.
 *
 * Shaped so it is obviously not a CCTP nonce: a real one is a bytes32 hex
 * string, this is `pending:<tx>:<logIndex>`. It is also unique per burn, which
 * matters because the table's UNIQUE(source_domain, nonce) constraint is what
 * makes a rescan idempotent — a shared placeholder would make the second burn in
 * a block collide with the first and vanish.
 */
export function pendingNonceKey(txHash: string, logIndex: number): string {
  return `pending:${txHash.toLowerCase()}:${logIndex}`;
}

export function isPendingNonce(nonce: string): boolean {
  return nonce.startsWith("pending:");
}

/**
 * One log from a CCTP contract, as this module consumes it.
 *
 * `blockTimestamp` rides along on the log wherever the endpoint supplies it, which
 * is what lets burnBlockTimes avoid a round of header fetches.
 */
type CctpLog = {
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  blockTimestamp: number | null;
};

/** Raw eth_getLogs for one contract and topic set, chunked over the range. */
async function getLogs(
  chain: ReturnType<typeof chainRowFor>,
  fromBlock: number,
  toBlock: number,
  address: string,
  topics: string[]
): Promise<CctpLog[]> {
  const out: CctpLog[] = [];

  for (let lo = fromBlock; lo <= toBlock; lo += LOGS_CHUNK_BLOCKS) {
    const hi = Math.min(toBlock, lo + LOGS_CHUNK_BLOCKS - 1);
    const logs = await evm.rawLogs(chain, { address, topics, fromBlock: lo, toBlock: hi });
    out.push(...logs);
  }
  return out;
}

/**
 * Block timestamps for the blocks a set of logs landed in.
 *
 * Takes them straight off the logs where the endpoint supplied `blockTimestamp`,
 * which on every endpoint measured is all of them — so this normally costs no RPC
 * calls at all. Only blocks that arrived undated are fetched, and those are capped
 * because a burn that cannot be dated is skipped rather than dated "now".
 */
async function burnBlockTimes(
  chain: ReturnType<typeof chainRowFor>,
  logs: Array<{ blockNumber: number; blockTimestamp: number | null }>
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (logs.length === 0) return out;

  for (const l of logs) {
    if (l.blockTimestamp !== null && !out.has(l.blockNumber)) {
      out.set(l.blockNumber, l.blockTimestamp);
    }
  }

  const undated = [...new Set(logs.map((l) => l.blockNumber))].filter((n) => !out.has(n));

  // Batched with a retry, via the provider — the same path the transfer scanner
  // uses. The previous one-block-at-a-time loop was also capped at 40 blocks, so a
  // wide CCTP scan on a chain whose endpoint omits blockTimestamp silently lost
  // burns past that cap.
  if (undated.length > 0) {
    for (const [n, ts] of await evm.blockTimestampsFor(chain, undated)) out.set(n, ts);
  }
  return out;
}

/**
 * Ask Iris for the nonce of burns still lacking one, and upgrade them.
 *
 * Run after scanning so a burn seen this tick gets a chance to be attested
 * before the next one. Bounded per call: Iris is a shared public service and a
 * backfill could otherwise queue thousands of lookups behind a 250ms gap.
 */
export async function attestPendingBurns(limit = 15): Promise<{
  checked: number;
  resolved: number;
  stillPending: number;
}> {
  const pending = cctpDb.pendingAttestation(limit);
  let resolved = 0;

  for (const row of pending) {
    cctpDb.markAttestAttempt(row.id);
    const msg = await nonceForBurn(row.sourceDomain, row.sourceTx);
    if (!msg) continue;

    // Iris's own view of the amount must agree with what we decoded off chain.
    // A mismatch means we are looking at a different burn in the same
    // transaction, and attaching that nonce would corrupt the row.
    if (msg.amount !== null && Math.abs(msg.amount - row.amount) > 0.01) {
      log.warn("iris amount disagrees with the decoded burn — leaving it pending", {
        tx: row.sourceTx,
        decoded: row.amount,
        iris: msg.amount,
      });
      continue;
    }

    if (cctpDb.assignNonce(row.id, msg.eventNonce, msg.feeExecuted)) resolved += 1;
  }

  return { checked: pending.length, resolved, stillPending: pending.length - resolved };
}

/** Scan every CCTP-capable EVM chain, then attest what is pending. */
export async function scanAllCctp(): Promise<{
  results: CctpScanResult[];
  attestation: Awaited<ReturnType<typeof attestPendingBurns>>;
}> {
  const results: CctpScanResult[] = [];
  for (const asset of getEvmScanAssets()) {
    if (asset.cctpDomain === null) continue;
    try {
      results.push(await scanCctpChain(asset));
    } catch (err) {
      results.push({
        chainSlug: asset.chainSlug,
        fromBlock: 0,
        toBlock: 0,
        burnsFound: 0,
        burnsNew: 0,
        mintsFound: 0,
        completed: 0,
        error: (err as Error).message.slice(0, 160),
      });
    }
  }
  const attestation = await attestPendingBurns();
  return { results, attestation };
}

export { cctpDomainName, getUsdcAsset, CCTP_V2_MSG, HEURISTIC_WINDOW_MS };
