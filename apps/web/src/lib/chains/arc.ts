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
