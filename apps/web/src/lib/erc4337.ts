import { concatHex, pad, toHex, type Hex } from "viem";

// ---------------------------------------------------------------------------
// ERC-4337 UserOperation construction (EntryPoint v0.8), with EIP-7702 support.
//
// WHY THIS IS A SEPARATE MODULE FROM eip7702.ts. That file decides whether a
// delegation is SAFE TO ACCEPT — allowlists, chain binding, revocation. This
// one decides how a UserOperation is SHAPED. They fail differently: a mistake
// there hands an attacker the account, a mistake here produces an operation the
// bundler silently drops.
//
// EVERYTHING HERE IS THE PACKING, AND THE PACKING IS WHERE THIS GOES WRONG.
// PackedUserOperation concatenates pairs of uint128 into single bytes32 words,
// and the field ORDER inside those words is not the order the unpacked struct
// lists them:
//
//   accountGasLimits = verificationGasLimit ‖ callGasLimit
//   gasFees          = maxPriorityFeePerGas ‖ maxFeePerGas     <- priority FIRST
//
// Swap either pair and you still produce a well-formed bytes32. The EntryPoint
// reads it, the numbers are wrong, and the failure surfaces as an out-of-gas or
// a mispriced operation rather than as a decoding error. Nothing type-checks
// this for you, so the tests pin the byte layout directly.
//
// SCOPE. Construction only — no submission. eth_sendUserOperation, the bundler
// and the EntryPoint are not reachable from this deployment (see
// eip7702.ts::sponsorshipAvailable). Building the object correctly is decidable
// offline; sending it is not.
// ---------------------------------------------------------------------------

/**
 * The EIP-7702 sentinel used in the `factory` field.
 *
 * Spec: "If the initCode field starts with 0x7702 right-padded with 18 zeros".
 * 0x7702 is two bytes; padded to a 20-byte address slot that is
 * 0x7702000000000000000000000000000000000000. It is a FLAG, not a contract —
 * nothing is deployed at it, and the EntryPoint reads it as "this sender is an
 * EOA carrying a 7702 delegation" rather than as a factory to call.
 */
export const EIP7702_FACTORY_FLAG = "0x7702000000000000000000000000000000000000" as const;

/**
 * Gas the EntryPoint cannot observe.
 *
 * EIP-7702 charges PER_EMPTY_ACCOUNT_COST for executing an authorization, but
 * that cost is paid by the outer transaction and is invisible on-chain to the
 * EntryPoint. The spec is explicit that it MUST be folded into
 * preVerificationGas. Omit it and the bundler is underpaid on every 7702
 * operation — it will simply stop accepting them, which reads as "our bundler
 * is flaky" rather than as an accounting bug.
 */
export const PER_EMPTY_ACCOUNT_COST = 25_000n;

/** Bundler sanity limits from the spec. Exceeding either is an instant drop. */
export const MAX_VERIFICATION_GAS = 500_000n;
export const PRE_VERIFICATION_OVERHEAD_GAS = 50_000n;

/** Appended to paymasterAndData to signal the optional paymasterSignature. */
export const PAYMASTER_SIG_MAGIC = "0x22e325a297439656" as const;

/** The unpacked UserOperation, as a client builds it. */
export interface UserOperation {
  sender: Hex;
  nonce: bigint;
  /** Account factory, or EIP7702_FACTORY_FLAG, or omitted. */
  factory?: Hex;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Hex;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  signature: Hex;
}

/** The on-chain form passed to the EntryPoint, Account and Paymaster. */
export interface PackedUserOperation {
  sender: Hex;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/** uint128 as 16 bytes. Throws rather than truncating — a silently wrapped gas
 *  limit is a mispriced operation, not a smaller one. */
function uint128(value: bigint, field: string): Hex {
  if (value < 0n) throw new RangeError(`${field} must be non-negative`);
  if (value > (1n << 128n) - 1n) throw new RangeError(`${field} exceeds uint128`);
  return pad(toHex(value), { size: 16 });
}

/**
 * Pack two uint128 into one bytes32.
 *
 * `high` occupies the leading 16 bytes. Which value is "high" differs per field
 * and is the single easiest thing to invert here, so both call sites below name
 * their arguments explicitly.
 */
function packPair(high: bigint, low: bigint, highName: string, lowName: string): Hex {
  return concatHex([uint128(high, highName), uint128(low, lowName)]);
}

/**
 * accountGasLimits = verificationGasLimit ‖ callGasLimit.
 *
 * Verification comes FIRST. Inverted, the account is given the execution budget
 * to validate with and vice versa — usually an out-of-gas during validation,
 * which looks like a broken account rather than a packing bug.
 */
export function packAccountGasLimits(op: Pick<UserOperation, "verificationGasLimit" | "callGasLimit">): Hex {
  return packPair(op.verificationGasLimit, op.callGasLimit, "verificationGasLimit", "callGasLimit");
}

/**
 * gasFees = maxPriorityFeePerGas ‖ maxFeePerGas.
 *
 * PRIORITY first — the opposite of how the unpacked struct and every EIP-1559
 * UI order them. Inverted, the operation offers a priority fee equal to the max
 * fee and a max fee equal to the tip, which either overpays wildly or is
 * rejected as underpriced.
 */
export function packGasFees(op: Pick<UserOperation, "maxPriorityFeePerGas" | "maxFeePerGas">): Hex {
  return packPair(op.maxPriorityFeePerGas, op.maxFeePerGas, "maxPriorityFeePerGas", "maxFeePerGas");
}

/**
 * initCode = factory ‖ factoryData, or empty.
 *
 * For a 7702 account the factory slot carries EIP7702_FACTORY_FLAG and the
 * remainder, if any, is an initialisation call ON THE ACCOUNT ITSELF — not a
 * factory call. The spec warns the initialiser can be invoked repeatedly
 * through the EntryPoint, so a wallet SHOULD NOT resend initCode once the
 * account is initialised.
 */
export function packInitCode(op: Pick<UserOperation, "factory" | "factoryData">): Hex {
  if (!op.factory) return "0x";
  return op.factoryData && op.factoryData !== "0x"
    ? concatHex([op.factory, op.factoryData])
    : op.factory;
}

/**
 * paymasterAndData = paymaster ‖ verificationGasLimit ‖ postOpGasLimit ‖ data.
 *
 * A non-standard packing: 20 bytes then two uint128 then free-form data. Empty
 * when there is no paymaster — an all-zero 20-byte address is NOT the same
 * thing, and bundlers reject it as a paymaster that is not a contract.
 */
export function packPaymasterAndData(op: UserOperation): Hex {
  if (!op.paymaster) return "0x";
  const parts: Hex[] = [
    op.paymaster,
    uint128(op.paymasterVerificationGasLimit ?? 0n, "paymasterVerificationGasLimit"),
    uint128(op.paymasterPostOpGasLimit ?? 0n, "paymasterPostOpGasLimit"),
  ];
  if (op.paymasterData && op.paymasterData !== "0x") parts.push(op.paymasterData);
  return concatHex(parts);
}

export function packUserOperation(op: UserOperation): PackedUserOperation {
  return {
    sender: op.sender,
    nonce: op.nonce,
    initCode: packInitCode(op),
    callData: op.callData,
    accountGasLimits: packAccountGasLimits(op),
    preVerificationGas: op.preVerificationGas,
    gasFees: packGasFees(op),
    paymasterAndData: packPaymasterAndData(op),
    signature: op.signature,
  };
}

// ── nonce ──────────────────────────────────────────────────────────────────

/**
 * The 256-bit nonce is a 192-bit key and a 64-bit sequence.
 *
 * The EntryPoint increments the sequence per key, so distinct keys are
 * independent channels — an administrative operation can proceed while a
 * regular one is in flight, without either blocking the other on ordering.
 */
export function encodeNonce(key: bigint, sequence: bigint): bigint {
  if (key < 0n || key > (1n << 192n) - 1n) throw new RangeError("nonce key exceeds uint192");
  if (sequence < 0n || sequence > (1n << 64n) - 1n) throw new RangeError("nonce sequence exceeds uint64");
  return (key << 64n) | sequence;
}

export function decodeNonce(nonce: bigint): { key: bigint; sequence: bigint } {
  if (nonce < 0n) throw new RangeError("nonce must be non-negative");
  return { key: nonce >> 64n, sequence: nonce & ((1n << 64n) - 1n) };
}

/**
 * Classic sequential nonce, i.e. key 0.
 *
 * The spec's own example: an account requiring strictly sequential nonces
 * validates `nonce < type(uint64).max`, which is exactly "the key is zero".
 */
export function isSequentialNonce(nonce: bigint): boolean {
  return nonce < 1n << 64n;
}

// ── preVerificationGas ─────────────────────────────────────────────────────

export interface PreVerificationGasInput {
  /** Serialized calldata cost for this operation. */
  calldataGas: bigint;
  /** Share of the bundle's base transaction cost (21000 / bundle size). */
  bundleShareGas?: bigint;
  /** True when the operation carries an EIP-7702 authorization. */
  hasAuthorization: boolean;
  /** Extra headroom for bundle position and memory expansion. Default 10%. */
  slackPct?: number;
}

/**
 * Estimate preVerificationGas.
 *
 * The spec deliberately declines to define a canonical formula, so this is an
 * estimate with the components it enumerates, and it rounds UP. The
 * consequence of under-estimating is not a slightly cheap operation: the
 * bundler drops it, and it drops it AFTER the user has signed.
 *
 * PER_EMPTY_ACCOUNT_COST is added for 7702 operations because the EntryPoint
 * cannot see that cost and will not add it for us.
 */
export function estimatePreVerificationGas(input: PreVerificationGasInput): bigint {
  const slackPct = BigInt(Math.max(0, Math.round(input.slackPct ?? 10)));
  const base =
    input.calldataGas +
    (input.bundleShareGas ?? 21_000n) +
    PRE_VERIFICATION_OVERHEAD_GAS +
    (input.hasAuthorization ? PER_EMPTY_ACCOUNT_COST : 0n);
  // Integer ceiling on the slack, so headroom is never rounded away.
  return base + (base * slackPct + 99n) / 100n;
}

// ── bundler sanity checks ──────────────────────────────────────────────────

export type UserOpRejection =
  | "verification_gas_too_high"
  | "paymaster_verification_gas_too_high"
  | "pre_verification_gas_too_low"
  | "call_gas_limit_too_low"
  | "fees_not_positive"
  | "paymaster_gas_without_paymaster"
  | "eip7702_requires_authorization";

export interface UserOpCheck {
  ok: boolean;
  reasons: UserOpRejection[];
}

/**
 * Apply the bundler's documented sanity checks locally.
 *
 * Every one of these is a rule a bundler applies before it will even add the
 * operation to its mempool. Checking them here turns a silent drop — the worst
 * failure mode, because the client has a signature and no error — into a
 * message naming the field.
 */
export function checkUserOperation(
  op: UserOperation,
  opts: { hasAuthorization?: boolean } = {}
): UserOpCheck {
  const reasons: UserOpRejection[] = [];

  if (op.verificationGasLimit > MAX_VERIFICATION_GAS) reasons.push("verification_gas_too_high");
  if ((op.paymasterVerificationGasLimit ?? 0n) > MAX_VERIFICATION_GAS) {
    reasons.push("paymaster_verification_gas_too_high");
  }
  if (op.preVerificationGas < PRE_VERIFICATION_OVERHEAD_GAS) reasons.push("pre_verification_gas_too_low");
  // "at least the cost of a CALL with non-zero value" — 9000 is that floor.
  if (op.callGasLimit < 9_000n) reasons.push("call_gas_limit_too_low");
  if (op.maxFeePerGas <= 0n || op.maxPriorityFeePerGas <= 0n) reasons.push("fees_not_positive");

  // Paymaster gas limits without a paymaster are silently ignored on-chain,
  // which usually means the caller believes it is sponsored and is not.
  if (!op.paymaster && ((op.paymasterVerificationGasLimit ?? 0n) > 0n || (op.paymasterPostOpGasLimit ?? 0n) > 0n)) {
    reasons.push("paymaster_gas_without_paymaster");
  }

  // A 7702-flagged operation without its authorization tuple cannot execute:
  // the EntryPoint has no delegate to match against the signature.
  if (op.factory?.toLowerCase() === EIP7702_FACTORY_FLAG && !opts.hasAuthorization) {
    reasons.push("eip7702_requires_authorization");
  }

  return { ok: reasons.length === 0, reasons };
}

/** Build the 7702-flavoured fields for an EOA-sender UserOperation. */
export function withEip7702Factory(
  op: Omit<UserOperation, "factory" | "factoryData">,
  initializerCall?: Hex
): UserOperation {
  return {
    ...op,
    factory: EIP7702_FACTORY_FLAG,
    // Only send an initializer the FIRST time. The spec notes the EntryPoint
    // cannot tell whether a 7702 account is initialised, so the initializer can
    // be called repeatedly through it; the wallet is responsible for not
    // resending it.
    ...(initializerCall && initializerCall !== "0x" ? { factoryData: initializerCall } : {}),
  };
}
