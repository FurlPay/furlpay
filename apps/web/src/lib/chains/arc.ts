import { getAddress, type Address } from "viem";

// ---------------------------------------------------------------------------
// Circle Arc — the chain where USDC IS the gas.
//
// Arc mainnet went live 2026-09-16: an EVM L1 with sub-second deterministic
// finality whose native gas asset is USDC rather than a volatile token. For
// FurlPay that removes the ETH float, the fee-payer top-up automation and the
// gas-expense account as separate problems — the fee payer holds the same asset
// the payment is denominated in.
//
// IT ALSO INTRODUCES THE ONLY DECIMAL HAZARD IN THE CODEBASE, and this module
// exists to be the single place it is handled.
//
//   One balance. Two interfaces. Different precision.
//
//   - NATIVE interface  — 18 decimals. Gas accounting, native sends, msg.value.
//                         This is the CANONICAL balance.
//   - ERC-20 interface  — 6 decimals. transfer/approve/allowance/balanceOf,
//                         matching USDC everywhere else in the world.
//
// They are the same money, not two holdings. Circle's guidance is explicit:
// "do not model native USDC and ERC-20 USDC as separate holdings." Modelling
// them as two assets would double-count every Arc balance, so `USDC.arc` is
// ONE asset in lib/money/money.ts, carried at the canonical 18 decimals.
//
// VERIFIED ON-CHAIN 2026-09-17 against https://rpc.mainnet.arc.io — measured,
// not copied from a doc:
//
//   eth_chainId                                 -> 0x13b2 (5042)
//   0x3600…0000 decimals()                      -> 6
//   0x3600…0000 symbol()                        -> "USDC"
//
//   account 0x8b1332e6414c830e823110667a6f0c10463d0f98
//     eth_getBalance                            -> 57628035984085784575   (18dp)
//     balanceOf                                 ->            57628035   ( 6dp)
//     57628035984085784575 / 10^12              ==           57628035   ✓
//
// That last line is the whole module in one observation: the ratio is exactly
// 10^12, and the ERC-20 view DISCARDED 984085784575 of sub-6dp dust. Which is
// why the native side is canonical and why `toErc20Units` truncates rather than
// rounds — rounding up would invent money that the ERC-20 interface cannot
// move, and a balance check would pass for a transfer that then reverts.
// ---------------------------------------------------------------------------

/** Arc mainnet. Verified via eth_chainId -> 0x13b2. */
export const ARC_MAINNET_CHAIN_ID = 5042;

/** Arc testnet. Faucet: https://faucet.circle.com */
export const ARC_TESTNET_CHAIN_ID = 5042002;

export const ARC_RPC = {
  mainnet: "https://rpc.mainnet.arc.io",
  testnet: "https://rpc.testnet.arc.io",
} as const;

export const ARC_EXPLORER = {
  mainnet: "https://explorer.arc.io",
  testnet: "https://explorer.testnet.arc.io",
} as const;

/**
 * The ERC-20 interface onto Arc's native USDC. A precompile-shaped address
 * (Circle's FiatTokenV2 behind an EIP-1967 proxy), identical on mainnet and
 * testnet. Verified on mainnet: decimals() == 6, symbol() == "USDC".
 *
 * NOTE this is an INTERFACE onto the native balance, not a separate token
 * contract holding wrapped funds. There is nothing to wrap.
 */
export const ARC_USDC_ERC20: Address = getAddress("0x3600000000000000000000000000000000000000");

/** Native (gas) precision. Canonical — never loses dust. */
export const ARC_NATIVE_DECIMALS = 18;

/** ERC-20 precision. Matches USDC on every other chain. Truncating view. */
export const ARC_ERC20_DECIMALS = 6;

/** 10^(18-6). The exact ratio between the two interfaces. */
export const ARC_DECIMAL_SCALE = 10n ** BigInt(ARC_NATIVE_DECIMALS - ARC_ERC20_DECIMALS);

/**
 * Native (18dp) -> ERC-20 (6dp). LOSSY BY DESIGN: anything below 1e-6 USDC is
 * truncated, exactly as the chain's own ERC-20 view does. Use
 * `erc20Remainder()` when you need to know what was dropped — for a balance
 * display that is fine, for a sweep or a reconciliation it is not.
 */
export function toErc20Units(native: bigint): bigint {
  // BigInt division truncates toward zero, which is right for positive amounts
  // and also right for negatives here: a negative balance is a bug upstream,
  // and truncating toward zero never reports MORE debt than exists.
  return native / ARC_DECIMAL_SCALE;
}

/** ERC-20 (6dp) -> native (18dp). Always exact — the scale is a clean power. */
export function toNativeUnits(erc20: bigint): bigint {
  return erc20 * ARC_DECIMAL_SCALE;
}

/**
 * The dust `toErc20Units` discarded: native - toNativeUnits(toErc20Units(native)).
 * Always in [0, 10^12). A non-zero remainder is why a zero ERC-20 balance does
 * NOT prove a zero native balance.
 */
export function erc20Remainder(native: bigint): bigint {
  return native % ARC_DECIMAL_SCALE;
}

/**
 * True when this native amount survives the ERC-20 interface intact. Check it
 * before quoting an exact-amount ERC-20 transfer of a native-denominated
 * figure, or the transfer moves less than the quote promised.
 */
export function isExactInErc20(native: bigint): boolean {
  return erc20Remainder(native) === 0n;
}

/**
 * Guard for the mistake this module exists to prevent: comparing or adding a
 * native-precision amount to an ERC-20-precision one. Both are "USDC on Arc"
 * and both are plain bigints, so nothing but a deliberate check distinguishes
 * them. Throws rather than returning false — a mixed-precision comparison is
 * never a recoverable condition, it is a bug that has already produced a wrong
 * number somewhere upstream.
 */
export class ArcPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcPrecisionError";
  }
}

/**
 * Assert that `value` is plausibly in the interface the caller says it is.
 * This cannot be exact — 1_000_000n is a legal amount in both interfaces — so
 * it catches the loud case: a native-scale figure handed to an ERC-20 sink is
 * ~10^12 times too large, which for USDC means "more than a trillion dollars".
 * That is never a real balance and always a scaling bug.
 */
export function assertErc20Scale(value: bigint, context: string): bigint {
  // 10^18 base units at 6dp = 1e12 USDC. No Arc account holds a trillion USDC;
  // a value this large is a native figure that skipped toErc20Units().
  const IMPLAUSIBLE_AT_6DP = 10n ** 18n;
  if (value >= IMPLAUSIBLE_AT_6DP) {
    throw new ArcPrecisionError(
      `${context}: ${value} is implausible as an ERC-20 (6dp) USDC amount — ` +
        `that is >= 1e12 USDC. This is almost certainly a native (18dp) amount ` +
        `that needed toErc20Units(). See lib/chains/arc.ts.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// THE FEE FLOOR — the one Arc difference with no failure signal at all.
//
// Source: https://docs.arc.io/arc/references/evm-differences, "Fee market".
// Arc sets a MINIMUM BASE FEE of 20 Gwei, and the doc is explicit about what
// happens below it: transactions under the minimum are "silently dropped with
// no error receipt".
//
// Every other Arc failure mode is observable. A blocklisted transfer, a burn, a
// send to the zero address — all of those are INCLUDED IN A BLOCK, consume gas,
// and leave a failed receipt you can read. This one leaves nothing. There is no
// receipt, no revert reason, no failed status, and no error from the node.
//
// WHY THAT IS THE DANGEROUS ONE. Absence of a receipt is exactly what a pending
// transaction looks like. Every receipt-polling loop ever written — including
// the ones in this repo — reads `null` as "not mined yet" and waits. So an
// underpriced Arc transaction does not fail; it hangs, indistinguishably from
// congestion, until some human gives up. If that transaction was a user's
// settlement leg, the money never moved and the system never learned.
//
// THE CONSEQUENCE FOR DESIGN: this can only be caught BEFORE submission. After
// broadcast there is no signal to check, so there is nothing a retry, a timeout
// or a reconciliation pass can key off. Hence a hard assert on the build path
// rather than a warning, a clamp, or a post-hoc check.
//
// NOT clamped deliberately. Silently raising a caller's fee spends the user's
// money at a price they did not quote, and on Arc the gas asset IS the asset
// being sent — so a clamp would quietly change the amount available to settle
// with. Refusing hands the decision back to the caller, who is the only one who
// knows whether a 20 Gwei floor still leaves the payment economic.
// ---------------------------------------------------------------------------

/**
 * Arc's minimum base fee, in wei of the 18-decimal native interface.
 *
 * 20 Gwei. A transaction whose `maxFeePerGas` is below this is dropped with no
 * receipt and no error — see the note above for why that is worse than a revert.
 */
export const ARC_MIN_BASE_FEE_WEI = 20_000_000_000n;

export class ArcFeeFloorError extends Error {
  constructor(
    message: string,
    readonly maxFeePerGas: bigint
  ) {
    super(message);
    this.name = "ArcFeeFloorError";
  }
}

/**
 * Refuse an Arc transaction that would be silently dropped.
 *
 * Call this on the BUILD path, before signing or broadcasting. Checking after
 * submission is not possible: a dropped transaction produces no receipt to
 * inspect, which is the whole hazard.
 *
 * Returns the fee unchanged so it can be used inline in a payload builder.
 */
export function assertArcFeeFloor(maxFeePerGas: bigint, context: string): bigint {
  if (maxFeePerGas < ARC_MIN_BASE_FEE_WEI) {
    throw new ArcFeeFloorError(
      `${context}: maxFeePerGas ${maxFeePerGas} wei is below Arc's minimum base ` +
        `fee of ${ARC_MIN_BASE_FEE_WEI} wei (20 Gwei). Arc DROPS such a ` +
        `transaction silently — no receipt, no error, no failed status — so it ` +
        `is indistinguishable from a pending transaction and will hang forever. ` +
        `Raise the fee deliberately; do not retry as-is. ` +
        `See https://docs.arc.io/arc/references/evm-differences.`,
      maxFeePerGas
    );
  }
  return maxFeePerGas;
}

// ---------------------------------------------------------------------------
// FORBIDDEN VALUE TRANSFERS, and how to tell them apart after the fact.
//
// Source: https://docs.arc.io/arc/references/evm-differences. On Arc a native
// transfer is a USDC transfer, so USDC's own rules apply to plain sends:
//
//   * to the zero address — reverts with "Zero address not allowed". A
//     ZERO-VALUE send to 0x0 succeeds, which is why the guard below takes the
//     value and not just the recipient.
//   * to or from a blocklisted address — reverts.
//   * a forbidden burn — SELFDESTRUCT to self while holding a balance, or any
//     non-zero-value call to an account that has already self-destructed. Note
//     this DIFFERS FROM ETHEREUM, where sending value to an address that
//     self-destructed earlier in the same transaction succeeds.
//   * to a precompile address — reverts.
//
// All of these are INCLUDED IN A BLOCK and consume gas. That is the good case:
// there is a failed receipt to read. It is also the trap for any code that
// treats "mined" as "done" — on Arc a mined USDC transfer may have moved
// nothing, so `receipt.status` has to be checked on every one.
//
// NO PRECOMPILE LIST IS HARDCODED HERE. The docs state the rule but do not
// enumerate Arc's precompile addresses, and a guessed list is worse than none:
// it would refuse legal recipients and still miss the real ones, while reading
// as authoritative. The classifier below recognises the revert when it happens;
// the pre-flight guard covers only what is actually documented.
// ---------------------------------------------------------------------------

/** Arc's documented revert reason for a value-bearing send to `0x0`. */
export const ARC_ZERO_ADDRESS_REVERT = "Zero address not allowed";

export class ArcForbiddenTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcForbiddenTransferError";
  }
}

/**
 * Refuse a native Arc send that is forbidden by rule rather than by balance.
 *
 * Only the zero-address rule is checked, because it is the only one knowable
 * without chain state — blocklist membership, self-destruct history and the
 * precompile set all require a node to answer. Those surface as reverts, and
 * `classifyArcTransferFailure` names them.
 */
export function assertArcValueTransfer(to: string, value: bigint, context: string): void {
  const isZeroAddress = /^0x0{40}$/i.test(to.trim());
  // A zero-VALUE send to 0x0 is legal on Arc and is not a burn, so the value
  // matters. Guarding on the address alone would refuse a legal call.
  if (isZeroAddress && value > 0n) {
    throw new ArcForbiddenTransferError(
      `${context}: a value-bearing transfer to the zero address reverts on Arc ` +
        `with "${ARC_ZERO_ADDRESS_REVERT}" — burning USDC is forbidden. The ` +
        `transaction would still be mined and still consume gas. ` +
        `See https://docs.arc.io/arc/references/evm-differences.`
    );
  }
}

/** Why an Arc transfer that was mined nonetheless moved nothing. */
export type ArcTransferFailure =
  | "blocklisted"
  | "zero_address"
  | "forbidden_burn"
  | "precompile_recipient"
  | "unknown";

/**
 * Classify a FAILED Arc transfer from its revert reason.
 *
 * Exists so a blocklist revert is not retried. The distinction is operational,
 * not cosmetic: a blocklisted counterparty is a PERMANENT condition and a
 * compliance event, and retrying it burns gas forever while telling the user
 * nothing. `unknown` is returned rather than guessed at — a wrong label on a
 * compliance-relevant failure is worse than an honest absence.
 *
 * Pass the revert reason, not the receipt: a bare `status === 0` says only that
 * something failed, which is exactly what this function cannot refine.
 */
export function classifyArcTransferFailure(revertReason: string | null | undefined): ArcTransferFailure {
  if (!revertReason) return "unknown";
  const r = revertReason.toLowerCase();
  if (r.includes("zero address")) return "zero_address";
  if (r.includes("blocklist") || r.includes("blacklist")) return "blocklisted";
  if (r.includes("burn")) return "forbidden_burn";
  if (r.includes("precompile")) return "precompile_recipient";
  return "unknown";
}

/**
 * True when this failure must NOT be retried.
 *
 * A blocklist is a standing decision by the issuer, and a burn rule is a
 * property of the chain. Neither clears on its own, so a retry is pure gas.
 */
export function isPermanentArcFailure(failure: ArcTransferFailure): boolean {
  return failure === "blocklisted" || failure === "zero_address" || failure === "forbidden_burn";
}

// ---------------------------------------------------------------------------
// THE DUAL EMITTER — Arc's other decimal hazard, and the one that can produce a
// wrong NUMBER rather than a failed transaction.
//
// Arc implements EIP-7708: native value movements emit an ERC-20-shaped Transfer
// log from a system address. So there are TWO Transfer streams for one asset:
//
//   0xffff…fffe  the SYSTEM EMITTER. Every native USDC movement, at 18 DECIMALS.
//                Includes the native leg of an ERC-20 transfer.
//   0x3600…0000  the USDC ERC-20 interface. ERC-20-interface activity only, at
//                6 DECIMALS.
//
// MEASURED ON ARC MAINNET 2026-09-25 (eth_getLogs over the Transfer topic across
// ~500 blocks at height 22,617,146) rather than copied from the docs:
//
//   emitter frequency        0xffff…fffe -> 3478 logs
//                            0x3600…0000 -> 2126 logs
//     the system emitter sees MORE, because it also logs every native leg.
//
//   one transfer(), both logs, in tx 0x42d155ba…c15d
//     system emitter  91528859000000000000   (18dp)
//     USDC ERC-20               91528859   ( 6dp)
//     ratio                 1000000000000   == 10^12 EXACTLY
//
//   native-only movement, in tx 0xbb74a675…cec9
//     system emitter  10639294662379335864   (18dp)
//     USDC ERC-20     (no log at all)
//
// TWO FAILURE MODES FALL OUT OF THAT, in opposite directions:
//
//   DOUBLE-CREDIT. Summing both streams counts every ERC-20 transfer twice. The
//   logs are not two transfers; they are two views of one. Arc's own integration
//   guidance is to "credit each underlying transfer once".
//
//   1e12 UNDER-ACCEPT. Comparing a system-emitter value against a 6dp
//   expectation passes for a payment 10^12 times too small: an expectation of
//   1000000 (=$1 at 6dp) is satisfied by 1000000 wei, which is $0.000000000001.
//   This is the dangerous one, because both sides are plain bigints and nothing
//   about `value >= expected` looks wrong.
//
//   Note the second is currently UNREACHABLE in lib/travel/settlementProof.ts,
//   and only by accident: that verifier requires the log emitter to equal the
//   USDC contract, so a system-emitter log is rejected before its value is read.
//   The accident cuts the other way too — a plain native Arc send, which is the
//   ordinary way to pay on a chain where USDC IS the gas, currently proves
//   NOTHING. It fails closed, which is the right direction to fail, but it is
//   not a deliberate decision and a future "fix" that simply adds the system
//   emitter to the accepted set converts a rejected payment into a 10^12
//   under-accept. Hence this section: normalise through here, never inline.
// ---------------------------------------------------------------------------

/**
 * Arc's EIP-7708 system emitter. Measured, not assumed — see the block above.
 *
 * Values in ITS logs are 18-decimal native amounts, NOT the 6-decimal amounts
 * every other chain's USDC Transfer log carries.
 */
export const ARC_SYSTEM_EMITTER: Address = getAddress("0xfffffffffffffffffffffffffffffffffffffffe");

/** keccak256("Transfer(address,address,uint256)"). Both streams use it. */
export const ARC_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Which Arc Transfer stream a log came from — and therefore its precision. */
export type ArcLogStream = "system_emitter_18dp" | "usdc_erc20_6dp" | "other";

export function arcLogStream(emitter: string): ArcLogStream {
  let normalised: Address;
  try {
    normalised = getAddress(emitter.trim());
  } catch {
    return "other";
  }
  if (normalised === ARC_SYSTEM_EMITTER) return "system_emitter_18dp";
  if (normalised === ARC_USDC_ERC20) return "usdc_erc20_6dp";
  return "other";
}

/**
 * Normalise a Transfer log's raw value to the CANONICAL 18-decimal native
 * scale, using the emitter to decide the input precision.
 *
 * This is the function that makes the two streams comparable. Doing the
 * comparison without it is the 1e12 under-accept described above.
 *
 * Throws on `other`: a Transfer log from some third token is not USDC and has no
 * business being scaled as though it were.
 */
export function arcLogValueToNative(emitter: string, rawValue: bigint): bigint {
  switch (arcLogStream(emitter)) {
    case "system_emitter_18dp":
      return rawValue; // already canonical
    case "usdc_erc20_6dp":
      return toNativeUnits(rawValue); // exact, 6dp -> 18dp
    case "other":
      throw new ArcPrecisionError(
        `Transfer log from ${emitter} is neither Arc's system emitter ` +
          `(${ARC_SYSTEM_EMITTER}) nor its USDC ERC-20 interface ` +
          `(${ARC_USDC_ERC20}); its precision is unknown so it cannot be ` +
          `normalised as USDC. See lib/chains/arc.ts.`
      );
  }
}

/** The minimum shape of a receipt log this module needs. */
export interface ArcTransferLogLike {
  address: string;
  topics: readonly string[];
  data: string;
  /** Present on receipt logs; carried through so a credit can be keyed to one log. */
  logIndex?: string;
  removed?: boolean;
}

/** One underlying USDC movement, already de-duplicated across both streams. */
export interface ArcCreditableTransfer {
  from: string;
  to: string;
  /** CANONICAL amount, 18dp. Use this for crediting. */
  nativeValue: bigint;
  /** 6dp view, truncated — for display and for ERC-20-side comparisons. */
  erc20Value: bigint;
  /** Sub-6dp dust the ERC-20 view would have discarded. Non-zero is legal. */
  dust: bigint;
  /** True when this movement ALSO produced a 6dp ERC-20 log, i.e. it went
   *  through `transfer()` rather than being a plain native send. */
  viaErc20Interface: boolean;
  /** logIndex of the SYSTEM-EMITTER log: the one stable key for this movement
   *  whichever interface moved it (undefined when the input log had none). */
  logIndex?: string;
}

/**
 * Extract every USDC movement in an Arc receipt, each counted ONCE.
 *
 * The system emitter is the authoritative stream because it observes every
 * movement; a matching ERC-20 log is recognised as the SAME movement and
 * recorded via `viaErc20Interface` rather than added. A plain native send, which
 * has no ERC-20 log at all, is still returned — that is the case a
 * USDC-contract-only filter misses entirely.
 *
 * Amounts come back at both precisions so a caller never has to pick a scale and
 * never has to convert inline.
 */
export function arcCreditableTransfers(
  logs: readonly ArcTransferLogLike[]
): ArcCreditableTransfer[] {
  // A log removed by a reorg is not a movement.
  const isTransfer = (l: ArcTransferLogLike) =>
    !l.removed && l.topics[0]?.toLowerCase() === ARC_TRANSFER_TOPIC && l.topics.length >= 3;

  const party = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase();

  // ERC-20 logs, kept as a consumable pool so N identical movements in one
  // transaction pair up N times rather than all matching the first log.
  const erc20Pool = logs
    .filter((l) => isTransfer(l) && arcLogStream(l.address) === "usdc_erc20_6dp")
    .map((l) => ({ from: party(l.topics[1]), to: party(l.topics[2]), used: false }));

  const out: ArcCreditableTransfer[] = [];

  for (const log of logs) {
    if (!isTransfer(log) || arcLogStream(log.address) !== "system_emitter_18dp") continue;

    const from = party(log.topics[1]);
    const to = party(log.topics[2]);
    let nativeValue: bigint;
    try {
      nativeValue = BigInt(log.data);
    } catch {
      continue; // an unparseable value is not a movement we can credit
    }

    const pair = erc20Pool.find((p) => !p.used && p.from === from && p.to === to);
    if (pair) pair.used = true;

    out.push({
      from,
      to,
      nativeValue,
      erc20Value: toErc20Units(nativeValue),
      dust: erc20Remainder(nativeValue),
      viaErc20Interface: Boolean(pair),
      logIndex: log.logIndex,
    });
  }

  return out;
}

/**
 * Arc behaviours that change how CONTRACTS must be written, recorded here
 * because they are easy to violate silently and there is no test that catches
 * them on a local simulator.
 *
 * Sources: https://docs.arc.io/arc/references/evm-differences.
 */
export const ARC_EVM_CONSTRAINTS = {
  /**
   * `PREVRANDAO` always returns 0. There is NO on-chain randomness on Arc, so
   * any contract deriving a secret, a selection or a nonce from it is fully
   * predictable. Use a VRF or an oracle.
   */
  prevrandaoIsAlwaysZero: true,
  /** Type-3 (EIP-4844 blob) transactions are rejected by the mempool. */
  blobTransactionsRejected: true,
  /** Base fee is paid to the block beneficiary, not burned. */
  baseFeeBurned: false,
  /** Finality is deterministic on inclusion — no confirmation depth to wait for. */
  finalisesOnInclusion: true,
  /** Target this in solc. Arc's baseline hard fork, including EIP-7702. */
  evmVersion: "osaka",
  /**
   * Local EVM simulators cannot reproduce the rules above — a plain `anvil`
   * will happily let a test burn USDC to `0x0`. Arc ships `arc-anvil`; a green
   * test on stock anvil is not evidence about Arc.
   */
  localSimulator: "arc-anvil",
} as const;
